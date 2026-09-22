import 'dotenv/config';

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AiIssueType, AiSeverity, StructuredAiResult } from '../tickets/ticket.types';

export interface RqstyAiInput {
  employeeId: string;
  jobTitle: string;
  productName: string;
  freeText: string;
}

@Injectable()
export class RqstyAiService {
  private readonly apiUrl = process.env.RQSTY_API_URL ?? 'https://router.requesty.ai/v1/chat/completions';
  private readonly model = process.env.RQSTY_MODEL ?? 'nvidia/nemotron-3-super-120b-a12b';
  private readonly apiKey = process.env.RQSTY_API_KEY;

  async generateStructuredResult(input: RqstyAiInput): Promise<StructuredAiResult> {
    if (!this.apiKey) {
      return this.buildFallbackResult(input);
    }

    try {
      const body = {
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'You are an internal operations triage assistant. Return only valid JSON with this schema: {"employeeId":"string","jobTitle":"string","freeText":"string","productName":"string","issueType":"hardware|software|network|access","severity":"low|medium|high|urgent","recommendedAction":"string"}. Use the employee and product context exactly, follow the issue carefully, and never include extra fields or markdown fences. For a broken chair, desk, monitor arm, or other workplace furniture/equipment, classify it as hardware and recommend inspection, repair, replacement, or Facilities escalation as appropriate; do not recommend device diagnostics. Recommendations must directly address the described object and problem.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              employeeId: input.employeeId,
              jobTitle: input.jobTitle,
              productName: input.productName,
              freeText: input.freeText,
            }),
          },
        ],
        temperature: 0.2,
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new InternalServerErrorException(`RQSTY request failed: ${response.status} ${errorText}`);
      }

      const completion = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
      };

      const contentCandidate = completion.choices?.[0]?.message?.content;
      const content = typeof contentCandidate === 'string'
        ? contentCandidate
        : Array.isArray(contentCandidate)
          ? contentCandidate.map((part) => part?.text ?? '').join('')
          : '';

      if (!content) {
        throw new InternalServerErrorException('RQSTY returned no content.');
      }

      const sanitizedContent = content.replace(/^```json\s*|```\s*$/gim, '').trim();

      const parsed = JSON.parse(sanitizedContent) as Partial<StructuredAiResult>;
      const requiredFields = ['employeeId', 'jobTitle', 'freeText', 'productName', 'issueType', 'severity', 'recommendedAction'];
      const missing = requiredFields.filter((field) => !parsed[field as keyof typeof parsed]);

      if (missing.length > 0) {
        throw new InternalServerErrorException(`RQSTY result is missing required fields: ${missing.join(', ')}`);
      }

      return {
        employeeId: input.employeeId,
        jobTitle: input.jobTitle,
        freeText: input.freeText.trim(),
        productName: input.productName,
        issueType: parsed.issueType as StructuredAiResult['issueType'],
        severity: parsed.severity as StructuredAiResult['severity'],
        recommendedAction: String(parsed.recommendedAction),
      };
    } catch (error) {
      if (error instanceof InternalServerErrorException && /RQSTY returned|RQSTY result/.test(error.message)) {
        throw error;
      }

      return this.buildFallbackResult(input, error);
    }
  }

  private buildFallbackResult(input: RqstyAiInput, error?: unknown): StructuredAiResult {
    const text = `${input.productName} ${input.freeText}`.toLowerCase();

    let issueType: AiIssueType = 'hardware';
    if (text.includes('vpn') || text.includes('login') || text.includes('access')) {
      issueType = 'access';
    } else if (text.includes('lag') || text.includes('network') || text.includes('wifi') || text.includes('internet')) {
      issueType = 'network';
    } else if (text.includes('crash') || text.includes('error') || text.includes('update') || text.includes('software')) {
      issueType = 'software';
    }

    let severity: AiSeverity = 'low';
    if (text.includes('cannot') || text.includes('urgent') || text.includes('down') || text.includes('blocked')) {
      severity = 'urgent';
    } else if (text.includes('slow') || text.includes('error') || text.includes('issue')) {
      severity = 'high';
    } else if (text.includes('intermittent') || text.includes('sometimes')) {
      severity = 'medium';
    }

    const isFurnitureOrPhysicalEquipment = /chair|desk|table|furniture|monitor arm|standing desk|drawer|cabinet|broken|damaged/.test(text);
    const recommendedAction = isFurnitureOrPhysicalEquipment
      ? severity === 'urgent'
        ? 'Remove the damaged equipment from use and escalate to Facilities for immediate repair or replacement.'
        : 'Inspect the damaged equipment and submit a Facilities repair or replacement request.'
      :
      issueType === 'access'
        ? severity === 'urgent'
          ? 'Reset access token and escalate to identity management.'
          : 'Verify account permissions and re-test access.'
        : issueType === 'network'
          ? severity === 'urgent'
            ? 'Check connectivity, device health, and network policy immediately.'
            : 'Run a connectivity test and review the affected network path.'
          : issueType === 'software'
            ? severity === 'urgent'
              ? 'Reinstall or rollback the affected software and capture the error logs.'
              : 'Review recent updates and validate the application state.'
            : severity === 'urgent'
              ? 'Inspect the device hardware health and arrange replacement or repair.'
              : 'Run a hardware health check and validate device diagnostics.';

    if (error) {
      void error;
    }

    return {
      employeeId: input.employeeId,
      jobTitle: input.jobTitle,
      freeText: input.freeText.trim(),
      productName: input.productName,
      issueType,
      severity,
      recommendedAction,
    };
  }
}
