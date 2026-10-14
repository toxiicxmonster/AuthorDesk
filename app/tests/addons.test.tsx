import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { busy, missing, spaceNeeded, type SetupStatus } from '../src/setup/addons';
import { AddonSetup, resetAddonOffer } from '../src/ui/components/AddonSetup';
import { resetDbForTests } from '../src/storage/db';
import { getSettings } from '../src/storage/settings';

const status = (over: Partial<Record<'ai' | 'grammar', Partial<SetupStatus['parts']['ai']>>> = {}, freeGb = 600): SetupStatus => {
  const part = (x: Partial<SetupStatus['parts']['ai']> = {}) => ({
    installed: false,
    available: true,
    state: 'idle' as const,
    step: '',
    percent: -1,
    message: '',
    updating: false,
    updateAvailable: false,
    ...x,
  });
  return { freeGb, parts: { ai: part(over.ai), grammar: part(over.grammar) } };
};

function fakeLauncher(states: SetupStatus[]) {
  const calls: string[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (String(url).startsWith('/setup/install')) i = Math.min(i + 1, states.length - 1);
      return new Response(JSON.stringify(states[i]), { headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}

describe('add-on sizes', () => {
  it('counts what stays installed plus the largest temporary overhead', () => {
    expect(spaceNeeded(['grammar'])).toBe(26);
    expect(spaceNeeded(['ai'])).toBe(10);
    expect(spaceNeeded(['grammar', 'ai'])).toBe(34);
    expect(spaceNeeded([])).toBe(0);
  });

  it('knows what is missing and what is installing', () => {
    const st = status({ grammar: { installed: true, state: 'done' }, ai: { state: 'installing' } });
    expect(missing(st)).toEqual(['ai']);
    expect(busy(st)).toEqual(['ai']);
    expect(missing(status({ ai: { available: false } }))).toEqual(['grammar']);
  });
});

describe('first-launch setup', () => {
  beforeEach(() => {
    resetDbForTests();
    resetAddonOffer();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks first, with both missing add-ons ticked, then installs in the background with progress', async () => {
    const calls = fakeLauncher([status(), status({ grammar: { state: 'installing', step: 'Downloading English usage data', percent: 42 }, ai: { state: 'queued' } })]);
    render(<AddonSetup />);
    expect(await screen.findByText(/Set up AuthorDesk’s private add-ons/)).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: /Grammar engine/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: /AI Editor/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/about 34 GB of free space/)).toBeTruthy();
    expect(calls.some((c) => c.startsWith('POST'))).toBe(false); // nothing downloads without a yes

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Install' })));
    expect(calls).toContain('POST /setup/install?parts=grammar,ai');
    expect(await screen.findByText(/Downloading English usage data 42%/)).toBeTruthy();
    expect(screen.getByText(/waiting its turn/)).toBeTruthy();
  });

  it('won’t start when the drive is too full', async () => {
    fakeLauncher([status({}, 20)]);
    render(<AddonSetup />);
    await screen.findByText(/Set up AuthorDesk’s private add-ons/);
    expect(screen.getByText(/This PC has 20 GB free/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Install' }) as HTMLButtonElement).disabled).toBe(true);
    // Unticking the big one makes the AI Editor alone fit.
    fireEvent.click(screen.getByRole('checkbox', { name: /Grammar engine/ }));
    expect((screen.getByRole('button', { name: 'Install' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('remembers “Don’t ask again”', async () => {
    fakeLauncher([status()]);
    render(<AddonSetup />);
    await screen.findByText(/Set up AuthorDesk’s private add-ons/);
    fireEvent.click(screen.getByRole('button', { name: /Don’t ask again/ }));
    await waitFor(async () => expect((await getSettings()).addonPrompt).toBe('never'));
  });

  it('shows add-on updates started at launch, and says when they finish', async () => {
    const installed = { installed: true, state: 'done' as const };
    let i = 0;
    const states = [
      status({ grammar: installed, ai: { installed: true, state: 'installing', updating: true, step: 'Downloading the model', percent: 12 } }),
      status({ grammar: installed, ai: { installed: true, state: 'done', updating: false } }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(states[Math.min(i++, states.length - 1)]), { headers: { 'Content-Type': 'application/json' } })),
    );
    render(<AddonSetup />);
    expect(await screen.findByText(/Updating/)).toBeTruthy();
    expect(screen.getByText(/Downloading the model 12%/)).toBeTruthy();
    expect(screen.queryByText(/Set up AuthorDesk’s private add-ons/)).toBeNull(); // nothing to offer: both are installed
    await waitFor(() => expect(screen.queryByText(/Downloading the model/)).toBeNull(), { timeout: 4000 });
  });
});
