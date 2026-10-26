// Types for the shared prompt-bar primitives (packages/studio/src/components/prompt/
// PromptComposer.jsx), used by the Local dashboard's TypeScript components.
declare module 'studio/prompt' {
  import type { ButtonHTMLAttributes, ForwardRefExoticComponent, HTMLAttributes, ReactNode, RefAttributes, TextareaHTMLAttributes } from 'react';

  type WithChildren = { children?: ReactNode; className?: string };

  export function promptControlClassName(options?: { active?: boolean; compact?: boolean; iconOnly?: boolean; className?: string }): string;
  export function promptMediaButtonClassName(options?: { active?: boolean; className?: string }): string;
  export const PROMPT_MEDIA_PREVIEW_CLASS: string;
  export const PROMPT_CONTROL_LABEL_CLASS: string;
  export function PromptChevronIcon(props: { className?: string }): ReactNode;
  export function PromptAspectRatioIcon(props: { className?: string }): ReactNode;
  export function PromptDurationIcon(props: { className?: string }): ReactNode;
  export function PromptQualityIcon(props: { className?: string }): ReactNode;
  export const PromptPopover: ForwardRefExoticComponent<
    HTMLAttributes<HTMLDivElement> & WithChildren & { positionClassName?: string; fitViewport?: boolean; solid?: boolean } & RefAttributes<HTMLDivElement>
  >;
  export function PromptPopoverHeader(props: WithChildren): ReactNode;
  export function PromptMenuList(props: WithChildren): ReactNode;
  export function PromptMenuItem(
    props: ButtonHTMLAttributes<HTMLButtonElement> & WithChildren & { description?: ReactNode; wrapDescription?: boolean; selected?: boolean },
  ): ReactNode;
  export function PromptSegmentedControl(props: WithChildren): ReactNode;
  export function PromptSegmentOption(props: ButtonHTMLAttributes<HTMLButtonElement> & WithChildren & { selected?: boolean }): ReactNode;
  export function PromptComposer(props: WithChildren & { panelClassName?: string; positionClassName?: string; style?: React.CSSProperties }): ReactNode;
  export const PromptTextarea: ForwardRefExoticComponent<
    TextareaHTMLAttributes<HTMLTextAreaElement> & { maxHeightMobile?: number; maxHeightDesktop?: number; 'data-testid'?: string } & RefAttributes<HTMLTextAreaElement>
  >;
  export function PromptFooter(props: WithChildren): ReactNode;
  export const PromptControls: ForwardRefExoticComponent<WithChildren & RefAttributes<HTMLDivElement>>;
  export const PromptAction: ForwardRefExoticComponent<ButtonHTMLAttributes<HTMLButtonElement> & WithChildren & { 'data-testid'?: string } & RefAttributes<HTMLButtonElement>>;
}
