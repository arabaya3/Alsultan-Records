/**
 * A checkbox drawn as a switch, for forms that are saved with their own button (`name` is submitted as "on" when
 * checked, like a plain checkbox). Native input underneath: keyboard (Space) and screen readers work as usual.
 */
export function SwitchField({
  name,
  defaultChecked,
  label,
  onText = "ظاهر",
  offText = "مخفي",
  testId,
}: {
  name: string;
  defaultChecked?: boolean;
  label: string;
  onText?: string;
  offText?: string;
  testId?: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-sm">
      <span className="font-medium">{label}</span>
      <span className="relative inline-flex items-center gap-2">
        {/* Transparent over the whole switch: clicks, Space and assistive tech reach the real checkbox. */}
        <input type="checkbox" name={name} defaultChecked={defaultChecked} className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0" data-testid={testId} />
        <span className="hidden text-on-cream peer-checked:inline">{onText}</span>
        <span className="text-on-cream-muted peer-checked:hidden">{offText}</span>
        <span
          aria-hidden="true"
          className="relative inline-flex h-7 w-12 items-center rounded-full border border-cream-line bg-cream-2 transition-colors peer-checked:border-gold-press peer-checked:bg-gold peer-focus-visible:ring-2 peer-focus-visible:ring-gold peer-focus-visible:ring-offset-2 [&>span]:start-[1.4rem] peer-checked:[&>span]:start-0.5"
        >
          <span className="absolute top-0.5 size-[1.375rem] rounded-full bg-white shadow transition-[inset-inline-start]" />
        </span>
      </span>
    </label>
  );
}
