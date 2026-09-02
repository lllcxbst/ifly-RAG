import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'

export type SelectOption = {
  value: string
  label: string
}

type SelectFieldProps = {
  options: SelectOption[]
  ariaLabel: string
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  name?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
  className?: string
  align?: 'start' | 'center' | 'end'
  menuLabel?: string
}

export default function SelectField({
  options,
  ariaLabel,
  value,
  defaultValue,
  onValueChange,
  name,
  required,
  disabled,
  placeholder = '请选择',
  className = '',
  align = 'start',
  menuLabel,
}: SelectFieldProps) {
  return (
    <Select.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      name={name}
      required={required}
      disabled={disabled}
    >
      <Select.Trigger className={`select-trigger ${className}`} aria-label={ariaLabel}>
        <span className="select-trigger-copy"><i /><Select.Value placeholder={placeholder} /></span>
        <Select.Icon className="select-chevron"><ChevronDown size={16} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="select-content" position="popper" sideOffset={8} align={align} collisionPadding={12}>
          <Select.ScrollUpButton className="select-scroll-button"><ChevronUp size={15} /></Select.ScrollUpButton>
          <Select.Viewport className="select-viewport">
            <div className="select-menu-label">{menuLabel || `${options.length} 个可用选项`}</div>
            {options.map((option) => (
              <Select.Item className="select-item" value={option.value} key={option.value}>
                <span className="select-item-copy"><i /><Select.ItemText>{option.label}</Select.ItemText></span>
                <Select.ItemIndicator className="select-indicator"><Check size={15} strokeWidth={2.6} /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="select-scroll-button"><ChevronDown size={15} /></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
