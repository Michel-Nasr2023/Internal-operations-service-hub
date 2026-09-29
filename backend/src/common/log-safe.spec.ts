import { describeError, maskEmail, ticketRef } from './log-safe';

describe('Log-safe descriptions', () => {
  it('keeps the error code and reason but removes file paths, web addresses and email addresses', () => {
    const locked = Object.assign(new Error("EBUSY: resource busy or locked, open 'C:\\Users\\maya\\OneDrive\\hub\\backend\\data\\attachments\\5f2c'"), { code: 'EBUSY' });
    expect(describeError(locked)).toBe("EBUSY: resource busy or locked, open '<path>'");

    const smtp = Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted. Learn more at https://support.google.com/mail/?p=BadCredentials'), { code: 'EAUTH' });
    expect(describeError(smtp)).toBe('EAUTH: Invalid login: 535-5.7.8 Username and Password not accepted. Learn more at <url>');

    expect(describeError(new Error('Recipient maya.stone@company.com rejected; see /var/app/backend/data/log'))).toBe('Recipient <email> rejected; see <path>');
    expect(describeError('plain text failure')).toBe('plain text failure');
  });

  it('refers to tickets by their short ID and masks email addresses', () => {
    expect(ticketRef('2ad75e8a-1601-484e-a01b-6d91bfc53573')).toBe('ticket 2ad75e8a');
    expect(maskEmail('maya.stone@company.com')).toBe('ma********@company.com');
  });
});
