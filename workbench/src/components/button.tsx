import { Button as AntButton, type ButtonProps } from 'antd';
import type { ButtonHTMLAttributes } from 'react';

const appearances = {
  default: { type: 'primary' },
  destructive: { type: 'primary', danger: true },
  outline: { type: 'default' },
  secondary: { color: 'primary', variant: 'filled' },
  ghost: { type: 'text' },
  link: { type: 'link' },
  cta: { type: 'primary' },
} satisfies Record<string, Partial<ButtonProps>>;

type Props = Omit<ButtonProps, 'type' | 'htmlType' | 'size' | 'variant'> & {
  type?: ButtonHTMLAttributes<HTMLButtonElement>['type'];
  variant?: keyof typeof appearances;
  size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';
};

export function Button({ type = 'button', variant = 'default', size = 'default', ...props }: Props) {
  const compact = size === 'xs' || size === 'sm' || size === 'icon-xs' || size === 'icon-sm';
  return <AntButton {...appearances[variant]} htmlType={type} size={compact ? 'small' : size === 'lg' || size === 'icon-lg' ? 'large' : 'middle'}
    data-slot="button" data-variant={variant} data-size={size} {...props} />;
}
