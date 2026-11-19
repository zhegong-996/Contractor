import type { Input as DesignInput, InputProps } from 'antd';
import BaseInput from 'antd/es/input/Input.js';
import BaseTextArea from 'antd/es/input/TextArea.js';
import type { ComponentProps } from 'react';

// Bundle the two controls directly and use the package's public prop types.
const AntInput = BaseInput as unknown as typeof DesignInput;
const AntTextArea = BaseTextArea as unknown as typeof DesignInput.TextArea;

export function Input(props: InputProps) {
  return <AntInput data-slot="input" {...props} />;
}

export function TextArea(props: ComponentProps<typeof AntTextArea>) {
  return <AntTextArea data-slot="textarea" {...props} />;
}
