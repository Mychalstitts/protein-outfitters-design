import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  createSupabaseClient,
  isSupabaseConfigured,
} from './supabase-client';

describe('isSupabaseConfigured', () => {
  it('returns true when url and anonKey are present', () => {
    expect(
      isSupabaseConfigured({ url: 'https://x.supabase.co', anonKey: 'k' }),
    ).toBe(true);
  });

  it('returns false when url is empty', () => {
    expect(isSupabaseConfigured({ url: '', anonKey: 'k' })).toBe(false);
  });

  it('returns false when anonKey is empty', () => {
    expect(
      isSupabaseConfigured({ url: 'https://x.supabase.co', anonKey: '' }),
    ).toBe(false);
  });
});

describe('createSupabaseClient stub (missing env)', () => {
  // Silence the intentional warning the factory emits.
  beforeAll(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('does not throw on construction with missing env', () => {
    expect(() =>
      createSupabaseClient({ url: '', anonKey: '' }),
    ).not.toThrow();
  });

  it('supports property chains without throwing', () => {
    const client = createSupabaseClient({ url: '', anonKey: '' });
    expect(() => {
      const chain = client.from('processors').select('*').eq('id', 'x').single();
      void chain;
    }).not.toThrow();
  });

  it('awaiting a stub query resolves to { data: null, error }', async () => {
    const client = createSupabaseClient({ url: '', anonKey: '' });
    const result = await client.from('processors').select('*');
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toMatch(/Supabase not configured/);
  });

  it('supports the realtime channel().on().subscribe() pattern', () => {
    const client = createSupabaseClient({ url: '', anonKey: '' });
    expect(() => {
      const channel = client.channel('x');
      // postgres_changes overload needs a Database generic; stub has none.
      // @ts-expect-error — runtime shape only
      channel.on('postgres_changes', { event: 'INSERT' }, () => {});
      channel.subscribe();
      client.removeChannel(channel);
    }).not.toThrow();
  });

  it('supports auth.signUp pattern', async () => {
    const client = createSupabaseClient({ url: '', anonKey: '' });
    const result = await client.auth.signUp({ email: 'a@b.co', password: 'x' });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('supports rpc() calls', async () => {
    const client = createSupabaseClient({ url: '', anonKey: '' });
    const result = await client.rpc('recent_network_events', { limit_count: 24 });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});
