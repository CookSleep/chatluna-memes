import { Combobox, Select } from '@base-ui/react'

export interface SelectOption {
  value: string
  label: string
  badge?: string
}

interface Props {
  label: string
  value: string
  options: SelectOption[]
  disabled?: boolean
  searchable?: boolean
  onChange(value: string): void
}

function Chevron() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
}

export function SelectControl({ label, value, options, disabled, searchable, onChange }: Props) {
  const current = options.find((item) => item.value === value)
  const trigger = <><span>{current?.label ?? value}</span><Chevron /></>
  if (searchable) {
    return <Combobox.Root<SelectOption> items={options} value={current ?? null} disabled={disabled}
      isItemEqualToValue={(a, b) => a.value === b.value}
      onValueChange={(item) => { if (item) onChange(item.value) }}>
      <Combobox.Trigger className="cm-select-control" aria-label={label}>{trigger}</Combobox.Trigger>
      <Combobox.Portal><Combobox.Positioner sideOffset={4} className="cm-select-positioner">
        <Combobox.Popup className="cm-select-popup">
          <Combobox.Input className="cm-select-search" aria-label={`搜索${label}`} placeholder={`搜索${label}`} />
          <Combobox.Empty className="cm-select-empty">没有匹配的模型</Combobox.Empty>
          <Combobox.List className="cm-select-list">{(item: SelectOption) =>
            <Combobox.Item key={item.value} value={item} className="cm-select-option">
              <span>{item.label}</span>{item.badge && <small>{item.badge}</small>}
            </Combobox.Item>}
          </Combobox.List>
        </Combobox.Popup>
      </Combobox.Positioner></Combobox.Portal>
    </Combobox.Root>
  }
  return <Select.Root<string> value={value} items={options} disabled={disabled}
    onValueChange={(next) => { if (next !== null) onChange(next) }}>
    <Select.Trigger className="cm-select-control" aria-label={label}>{trigger}</Select.Trigger>
    <Select.Portal><Select.Positioner alignItemWithTrigger={false} sideOffset={4} className="cm-select-positioner">
      <Select.Popup className="cm-select-popup"><Select.List className="cm-select-list">
        {options.map((item) => <Select.Item className="cm-select-option" value={item.value} key={item.value}>
          <Select.ItemText>{item.label}</Select.ItemText>
        </Select.Item>)}
      </Select.List></Select.Popup>
    </Select.Positioner></Select.Portal>
  </Select.Root>
}
