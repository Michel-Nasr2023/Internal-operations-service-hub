import { RqstyAiService, TicketAnalysisInput } from './rqsty-ai.service';

const input: TicketAnalysisInput = {
  requesterName: 'Maya Stone',
  jobTitle: 'Operations Analyst',
  title: 'vpn not working',
  description: 'since update yesterday cant get on vpn, says auth error. tried restart',
  team: 'IT Operations',
  issueType: 'access',
  project: 'Internal tools',
};

const validAnalysis = {
  summary: 'VPN authentication fails after update',
  clarifiedDescription: 'The employee reports that since the update yesterday the VPN rejects their login with an authentication error. Restarting did not help.',
  issueType: 'access',
  severity: 'high',
  recommendedAction: 'Check whether the update reset the VPN certificate.',
  missingInformation: ['Which VPN client version is installed?'],
  isUnclear: false,
};

function completion(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
}

function providerError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), { status });
}

// Skips the real pauses between retries, and has a clock the test can move forward.
class TestAiService extends RqstyAiService {
  readonly pauses: number[] = [];
  clock = Date.now();
  protected override sleep(ms: number): Promise<void> {
    this.pauses.push(ms);
    return Promise.resolve();
  }
  protected override now(): number {
    return this.clock;
  }
}

describe('RqstyAiService', () => {
  const originalKey = process.env.RQSTY_API_KEY;

  beforeEach(() => {
    process.env.RQSTY_API_KEY = 'test-key';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.RQSTY_API_KEY = originalKey;
  });

  it('returns the model analysis, tolerating fences, capitals and severity synonyms', async () => {
    const reply = { ...validAnalysis, issueType: 'ACCESS', severity: 'major', missingInformation: ['Which VPN client version is installed?', 42] };
    jest.spyOn(global, 'fetch').mockResolvedValue(completion('Here you go:\n```json\n' + JSON.stringify(reply) + '\n```'));

    const fetchSpy = jest.spyOn(global, 'fetch');
    const result = await new TestAiService().analyzeTicket(input);

    // The project/area reaches the model under a self-explanatory name.
    const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)) as { messages: Array<{ content: string }> };
    expect(JSON.parse(sent.messages[1].content)).toMatchObject({ projectOrArea: 'Internal tools', subject: 'vpn not working' });

    expect(result).toMatchObject({
      source: 'ai',
      summary: 'VPN authentication fails after update',
      issueType: 'access',
      severity: 'high',
      missingInformation: ['Which VPN client version is installed?'],
      isUnclear: false,
      attempts: 1,
    });
  });

  it('keeps an unclear ticket as a real AI answer flagged as unclear', async () => {
    const unclear = {
      summary: 'Unclear request: the employee only wrote "hey"',
      clarifiedDescription: 'The employee wrote only "hey" with no description of a problem.',
      issueType: 'hardware',
      severity: 'low',
      recommendedAction: 'Contact the employee to find out what they need help with.',
      missingInformation: ['What problem are you experiencing?', 'Which device or system is affected?'],
      isUnclear: true,
    };
    jest.spyOn(global, 'fetch').mockResolvedValue(completion(JSON.stringify(unclear)));

    const result = await new TestAiService().analyzeTicket({ ...input, title: 'hey', description: 'hey' });

    expect(result).toMatchObject({ source: 'ai', isUnclear: true, severity: 'low' });
    expect(result.source === 'ai' && result.missingInformation).toHaveLength(2);
  });

  it('uses the employee-selected issue type when the model returns an unknown one', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(completion(JSON.stringify({ ...validAnalysis, issueType: 'printer' })));

    const result = await new TestAiService().analyzeTicket(input);

    expect(result).toMatchObject({ source: 'ai', issueType: 'access' });
  });

  it('asks the model again after an unusable reply, showing it the bad answer', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(completion('Sure! The VPN is broken.'))
      .mockResolvedValueOnce(completion(JSON.stringify(validAnalysis)));

    const result = await new TestAiService().analyzeTicket(input);

    expect(result).toMatchObject({ source: 'ai', attempts: 2 });
    const secondRequest = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body)) as { messages: Array<{ role: string; content: string }> };
    expect(secondRequest.messages.slice(-2).map((message) => message.role)).toEqual(['assistant', 'user']);
  });

  it('retries a busy or overloaded provider with pauses, then records a failure instead of a made-up answer', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(providerError(429, 'too many concurrent requests'))
      .mockResolvedValueOnce(providerError(503, 'Service temporarily overloaded'))
      .mockResolvedValueOnce(providerError(503, 'Service temporarily overloaded'));
    const service = new TestAiService();

    const result = await service.analyzeTicket(input);

    expect(service.pauses).toEqual([5000, 15000]);
    expect(result).toEqual({
      source: 'failed',
      failureCode: 'provider-error',
      failureReason: 'The AI service reported an error (503) after 3 attempts.',
      attempts: 3,
      temporary: true,
      generatedAt: expect.any(String),
    });
    expect(result).not.toHaveProperty('clarifiedDescription');
  });

  it('pauses AI requests after 3 outages in a row, then tries again once the pause is over', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => providerError(503, 'Service unavailable'));
    const service = new TestAiService();

    for (let ticket = 1; ticket <= 3; ticket += 1) {
      expect(await service.analyzeTicket(input)).toMatchObject({ source: 'failed', failureCode: 'provider-error', temporary: true });
    }
    const callsSoFar = fetchSpy.mock.calls.length;

    // Paused: the next ticket fails at once, without waiting on the provider.
    expect(await service.analyzeTicket(input)).toMatchObject({ source: 'failed', failureCode: 'unavailable', temporary: true, attempts: 0 });
    expect(fetchSpy).toHaveBeenCalledTimes(callsSoFar);

    service.clock += 2 * 60 * 1000;
    fetchSpy.mockImplementation(async () => completion(JSON.stringify(validAnalysis)));
    expect(await service.analyzeTicket(input)).toMatchObject({ source: 'ai' });
  });

  it('recovers when a retry succeeds', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(providerError(503, 'Service temporarily overloaded'))
      .mockResolvedValueOnce(completion(JSON.stringify(validAnalysis)));

    expect(await new TestAiService().analyzeTicket(input)).toMatchObject({ source: 'ai', attempts: 2 });
  });

  it('does not retry a timeout or a rejected API key', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValueOnce(timeout);

    const timedOut = await new TestAiService().analyzeTicket(input);
    // A timeout is worth trying again later (automatically); a refused API key is not.
    expect(timedOut).toMatchObject({ source: 'failed', failureCode: 'timeout', attempts: 1, temporary: true });
    expect(timedOut.source === 'failed' && timedOut.failureReason).toMatch(/did not answer within \d+ seconds/);

    fetchSpy.mockReset().mockResolvedValueOnce(providerError(401, 'invalid key'));
    expect(await new TestAiService().analyzeTicket(input)).toMatchObject({ source: 'failed', failureCode: 'provider-error', attempts: 1, temporary: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('reports a clear failure without calling the provider when no API key is configured', async () => {
    delete process.env.RQSTY_API_KEY;
    const fetchSpy = jest.spyOn(global, 'fetch');

    const result = await new TestAiService().analyzeTicket(input);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ source: 'failed', failureCode: 'not-configured', attempts: 0 });
  });
});
