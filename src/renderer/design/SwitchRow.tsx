import { Description, Label, Switch } from '@heroui/react';

/** The whole row toggles, with the switch on the right (DESIGN.md › Settings). */
export function SwitchRow({
  label,
  description,
  isSelected,
  onChange,
  isDisabled,
  flush = false,
}: {
  label: string;
  description: string;
  isSelected: boolean;
  onChange: (value: boolean) => void;
  isDisabled?: boolean;
  /** Fills a Settings card edge to edge, instead of reaching past a plain column. */
  flush?: boolean;
}) {
  return (
    <Switch
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled}
      className={
        flush
          ? 'settings-row w-full cursor-pointer px-4'
          : '-mx-3 w-[calc(100%+1.5rem)] cursor-pointer rounded-md px-3 hover:bg-sunken'
      }
    >
      {/* Only Content is clickable, so the control has to be inside it. */}
      <Switch.Content className="flex min-h-16 w-full flex-row items-center justify-between gap-4 text-left">
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <Label className="cursor-pointer font-medium">{label}</Label>
          <Description className="text-sm text-muted">
            {description}
          </Description>
        </span>
        <Switch.Control className="shrink-0">
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}
