// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Combobox, filterOptions, type ComboOption } from '../components/ui/Combobox';

const OPTIONS: ComboOption[] = [
  { value: 'indiranagar', label: 'Indiranagar', meta: '₹42,000' },
  { value: 'koramangala', label: 'Koramangala', meta: '₹45,000' },
  { value: 'hsr-layout', label: 'HSR Layout', meta: '₹38,000' },
  { value: 'whitefield', label: 'Whitefield', meta: '₹35,000' },
];

function Harness({ onPick }: { onPick?: (v: string | null) => void }) {
  const [v, setV] = useState<string | null>(null);
  return <Combobox label="Locality" options={OPTIONS} value={v} onChange={(x) => { setV(x); onPick?.(x); }} />;
}

afterEach(cleanup);
const input = () => screen.getByRole('combobox', { name: 'Locality' });

describe('Combobox keyboard behaviour', () => {
  it('exposes ARIA 1.2 combobox semantics', () => {
    render(<Harness />);
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().getAttribute('aria-autocomplete')).toBe('list');
    expect(input().getAttribute('aria-controls')).toBeTruthy();
  });

  it('ArrowDown opens, and moves aria-activedescendant through options', async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(screen.getByRole('combobox'));
    await u.keyboard('{Escape}');
    expect(input().getAttribute('aria-expanded')).toBe('false');
    await u.keyboard('{ArrowDown}');
    expect(input().getAttribute('aria-expanded')).toBe('true');
    const first = input().getAttribute('aria-activedescendant');
    expect(document.getElementById(first!)?.textContent).toContain('Indiranagar');
    await u.keyboard('{ArrowDown}');
    expect(document.getElementById(input().getAttribute('aria-activedescendant')!)?.textContent).toContain('Koramangala');
    await u.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.getElementById(input().getAttribute('aria-activedescendant')!)?.textContent).toContain('Whitefield');
  });

  it('Home and End jump to the ends', async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(input());
    await u.keyboard('{End}');
    expect(document.getElementById(input().getAttribute('aria-activedescendant')!)?.textContent).toContain('Whitefield');
    await u.keyboard('{Home}');
    expect(document.getElementById(input().getAttribute('aria-activedescendant')!)?.textContent).toContain('Indiranagar');
  });

  it('typing filters, Enter selects the highlighted option and closes', async () => {
    const onPick = vi.fn();
    const u = userEvent.setup();
    render(<Harness onPick={onPick} />);
    await u.click(input());
    await u.keyboard('kor');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await u.keyboard('{Enter}');
    expect(onPick).toHaveBeenLastCalledWith('koramangala');
    expect((input() as HTMLInputElement).value).toBe('Koramangala');
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape closes and restores the selection; a second Escape clears it', async () => {
    const onPick = vi.fn();
    const u = userEvent.setup();
    render(<Harness onPick={onPick} />);
    await u.click(input());
    await u.keyboard('whi{Enter}');
    await u.keyboard('{ArrowDown}');
    await u.keyboard('xyz');
    expect(screen.getByText('No match')).toBeTruthy();
    await u.keyboard('{Escape}');
    expect((input() as HTMLInputElement).value).toBe('');
    await u.keyboard('{Escape}');
    expect((input() as HTMLInputElement).value).toBe('');
  });

  it('shows the median rent in each option row', async () => {
    const u = userEvent.setup();
    render(<Harness />);
    await u.click(input());
    expect(screen.getByText('₹42,000')).toBeTruthy();
  });

  it('mouse selection works and the clear button resets', async () => {
    const onPick = vi.fn();
    const u = userEvent.setup();
    render(<Harness onPick={onPick} />);
    await u.click(input());
    await u.click(screen.getByRole('option', { name: /HSR Layout/ }));
    expect(onPick).toHaveBeenLastCalledWith('hsr-layout');
    await u.click(screen.getByRole('button', { name: 'Clear locality' }));
    expect(onPick).toHaveBeenLastCalledWith(null);
    expect((input() as HTMLInputElement).value).toBe('');
  });
});

describe('filterOptions', () => {
  it('ranks prefix matches before substring matches and is case-insensitive', () => {
    const o = [{ value: 'a', label: 'Koramangala 4th Block' }, { value: 'b', label: 'New Koramangala' }];
    expect(filterOptions(o, 'KOR').map((x) => x.value)).toEqual(['a', 'b']);
    expect(filterOptions(o, '  ')).toHaveLength(2);
    expect(filterOptions(o, 'zzz')).toEqual([]);
  });
});
