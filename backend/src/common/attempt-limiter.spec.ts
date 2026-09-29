import { AttemptLimiter, waitDescription } from './attempt-limiter';

describe('AttemptLimiter', () => {
  it('blocks a key once it uses up its allowance, until its window ends', () => {
    let now = 0;
    const limiter = new AttemptLimiter(3, 60_000, () => now);

    expect(limiter.hit('a')).toBe(false);
    expect(limiter.hit('a')).toBe(false);
    expect(limiter.blockedFor('a')).toBe(0);
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.blockedFor('a')).toBe(60);
    expect(limiter.blockedFor('b')).toBe(0);

    now = 45_000;
    expect(limiter.blockedFor('a')).toBe(15);

    now = 60_000;
    expect(limiter.blockedFor('a')).toBe(0);
    expect(limiter.hit('a')).toBe(false);
  });

  it('forgets a key when it is reset', () => {
    const limiter = new AttemptLimiter(1, 60_000);
    limiter.hit('a');
    expect(limiter.blockedFor('a')).toBeGreaterThan(0);
    limiter.reset('a');
    expect(limiter.blockedFor('a')).toBe(0);
  });

  it('describes the wait in words', () => {
    expect(waitDescription(1)).toBe('in 1 second');
    expect(waitDescription(40)).toBe('in 40 seconds');
    expect(waitDescription(61)).toBe('in 2 minutes');
    expect(waitDescription(900)).toBe('in 15 minutes');
  });
});
