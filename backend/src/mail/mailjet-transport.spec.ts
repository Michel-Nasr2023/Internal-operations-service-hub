import { createMailjetTransport, parseAddress } from './mailjet-transport';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const message = { from: 'Service Hub <hub@example.com>', to: 'maya@company.com', subject: 'Reset your password', text: 'Code 123456', html: '<p>Code 123456</p>' };

describe('Mailjet transport', () => {
  const transport = createMailjetTransport('key', 'secret', 'Service Hub <hub@example.com>');

  afterEach(() => jest.restoreAllMocks());

  it('sends the email through the Mailjet API with the account keys', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(reply(200, { Messages: [{ Status: 'success' }] }));

    await transport.sendMail(message);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mailjet.com/v3.1/send');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('key:secret').toString('base64')}`);
    expect(JSON.parse(String(init.body)).Messages[0]).toEqual({
      From: { Email: 'hub@example.com', Name: 'Service Hub' },
      To: [{ Email: 'maya@company.com' }],
      Subject: 'Reset your password',
      TextPart: 'Code 123456',
      HTMLPart: '<p>Code 123456</p>',
    });
  });

  it('reports failures with the codes the retry rules understand', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    fetchSpy.mockResolvedValueOnce(reply(503, {}));
    await expect(transport.sendMail(message)).rejects.toMatchObject({ code: 'ECONNECTION' }); // temporary: retried

    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(transport.sendMail(message)).rejects.toMatchObject({ code: 'ECONNECTION' }); // unreachable: retried

    fetchSpy.mockResolvedValueOnce(reply(401, {}));
    await expect(transport.sendMail(message)).rejects.toMatchObject({ code: 'EAUTH' }); // wrong keys: not retried

    fetchSpy.mockResolvedValueOnce(reply(400, { Messages: [{ Status: 'error', Errors: [{ ErrorMessage: 'Invalid email address' }] }] }));
    await expect(transport.sendMail(message)).rejects.toMatchObject({ code: 'EENVELOPE', message: expect.stringContaining('Invalid email address') });
  });

  it('checks at start-up that the sender address is confirmed in Mailjet', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    fetchSpy.mockResolvedValueOnce(reply(200, { Data: [{ Email: 'HUB@example.com', Status: 'Active' }] }));
    await expect(transport.verify()).resolves.toBe(true);

    fetchSpy.mockResolvedValueOnce(reply(200, { Data: [{ Email: 'hub@example.com', Status: 'Inactive' }] }));
    await expect(transport.verify()).rejects.toThrow('is not confirmed in Mailjet yet');

    fetchSpy.mockResolvedValueOnce(reply(200, { Data: [] }));
    await expect(transport.verify()).rejects.toThrow('is not a sender in Mailjet yet');
  });

  it('reads the sender name and address', () => {
    expect(parseAddress('"Service Hub" <hub@example.com>')).toEqual({ Email: 'hub@example.com', Name: 'Service Hub' });
    expect(parseAddress('hub@example.com')).toEqual({ Email: 'hub@example.com' });
  });
});
