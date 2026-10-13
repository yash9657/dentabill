'use client';

import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';
import {
  Controller,
  FormProvider,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
  useFormContext,
} from 'react-hook-form';

import { cn } from '../lib/utils.js';

import { Label } from './label.js';

/**
 * Form — wrapper around react-hook-form's FormProvider. Renders a <form>
 * element and applies styling. Pass the `useForm` instance as `form`, and
 * add handlers for `onSubmit` via `handleSubmit`.
 */
interface FormProps<
  TFieldValues extends FieldValues = FieldValues,
> extends React.FormHTMLAttributes<HTMLFormElement> {
  form: UseFormReturn<TFieldValues>;
}

export const Form = Object.assign(
  React.forwardRef<HTMLFormElement, FormProps>(function Form({ className, form, ...props }, ref) {
    return (
      <FormProvider {...form}>
        <form ref={ref} className={cn('w-full space-y-6', className)} {...props} />
      </FormProvider>
    );
  }),
  { displayName: 'Form' },
);

/**
 * FormFieldContext — carries the id, name, and form state into the tree.
 */
interface FormFieldContextValue<TFieldValues extends FieldValues = FieldValues> {
  name: FieldPath<TFieldValues>;
}

const FormFieldContext = React.createContext<FormFieldContextValue | undefined>(undefined);

/**
 * FormField — wraps a Controller from react-hook-form. Passes the field's
 * state into the context so child FormItem can access error/disabled.
 */
interface FormFieldProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  name: TName;
  children: (form: {
    field: ControllerRenderProps<TFieldValues, TName>;
    fieldState: unknown;
  }) => React.ReactElement;
}

export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ name, children }: FormFieldProps<TFieldValues, TName>): React.ReactElement {
  const formContext = useFormContext<TFieldValues>();

  return (
    <FormFieldContext.Provider value={{ name }}>
      <Controller
        name={name}
        control={formContext.control}
        render={({ field, fieldState }) => children({ field, fieldState })}
      />
    </FormFieldContext.Provider>
  );
}

/**
 * FormItemContext — carries the id and description/error id so <input> can
 * wire up aria-describedby, aria-invalid, etc.
 */
interface FormItemContextValue {
  id: string;
  formItemId: string;
  formDescriptionId: string;
  formMessageId: string;
}

const FormItemContext = React.createContext<FormItemContextValue | undefined>(undefined);

/**
 * FormItem — wraps the field parts (label, control, description, message)
 * in a container with a unique ID.
 */
type FormItemProps = React.HTMLAttributes<HTMLDivElement>;

export const FormItem = React.forwardRef<HTMLDivElement, FormItemProps>(function FormItem(
  { className, ...props },
  ref,
) {
  const id = React.useId();

  return (
    <FormItemContext.Provider
      value={{
        id,
        formItemId: `${id}-form-item`,
        formDescriptionId: `${id}-form-item-description`,
        formMessageId: `${id}-form-item-message`,
      }}
    >
      <div ref={ref} className={cn('space-y-1.5', className)} {...props} />
    </FormItemContext.Provider>
  );
});
FormItem.displayName = 'FormItem';

/**
 * useFormField — hook to access FormField + FormItem context. Used by Label,
 * Control, Description, and Message.
 */
interface UseFormFieldReturn {
  id: string;
  name: string;
  formItemId: string;
  formDescriptionId: string;
  formMessageId: string;
  error: unknown;
  disabled: boolean;
}

export function useFormField(): UseFormFieldReturn {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const formContext = useFormContext();

  if (!fieldContext) {
    throw new Error('useFormField must be used within a <FormField>');
  }

  if (!itemContext) {
    throw new Error('useFormField must be used within a <FormItem>');
  }

  const fieldState = formContext.getFieldState(fieldContext.name, formContext.formState);

  return {
    id: itemContext.id,
    name: fieldContext.name,
    formItemId: itemContext.formItemId,
    formDescriptionId: itemContext.formDescriptionId,
    formMessageId: itemContext.formMessageId,
    error: fieldState.error,
    disabled: formContext.formState.disabled,
  };
}

/**
 * FormLabel — wraps our Label primitive. Links via htmlFor and uses
 * data-error to style invalid state.
 */
type FormLabelProps = React.ComponentPropsWithoutRef<typeof Label>;

export const FormLabel = React.forwardRef<React.ComponentRef<typeof Label>, FormLabelProps>(
  function FormLabel({ ...props }, ref) {
    const { error, formItemId } = useFormField();

    return (
      <Label
        ref={ref}
        htmlFor={formItemId}
        data-error={error ? 'true' : undefined}
        className={error ? 'text-gray-dark' : ''}
        {...props}
      />
    );
  },
);
FormLabel.displayName = 'FormLabel';

/**
 * FormControl — uses Radix Slot to inject form-wiring attributes onto the
 * slotted child (typically an Input). Injects:
 *   - id={formItemId}
 *   - aria-describedby={formDescriptionId formMessageId}
 *   - aria-invalid={error ? 'true' : 'false'}
 *   - disabled={disabled}
 */
type FormControlProps = React.HTMLAttributes<HTMLDivElement>;

export const FormControl = React.forwardRef<HTMLDivElement, FormControlProps>(function FormControl(
  { children, ...props },
  ref,
) {
  const { error, formItemId, formDescriptionId, formMessageId, disabled } = useFormField();

  return (
    <Slot
      ref={ref}
      id={formItemId}
      aria-describedby={`${formDescriptionId} ${formMessageId}`.trim() || undefined}
      aria-invalid={error ? 'true' : 'false'}
      {...(disabled && { disabled: true })}
      {...props}
    >
      {children}
    </Slot>
  );
});
FormControl.displayName = 'FormControl';

/**
 * FormDescription — helper text below the input. Uses caption type scale and
 * warm gray text.
 */
type FormDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>;

export const FormDescription = React.forwardRef<HTMLParagraphElement, FormDescriptionProps>(
  function FormDescription({ className, ...props }, ref) {
    const { formDescriptionId } = useFormField();

    return (
      <p
        ref={ref}
        id={formDescriptionId}
        className={cn('text-caption text-gray-warm', className)}
        {...props}
      />
    );
  },
);
FormDescription.displayName = 'FormDescription';

/**
 * FormMessage — displays either the children or the field's error message.
 * When an error is present, renders with role="alert" so screen readers
 * announce it. Achromatic styling per ADR-013 — uses weight + layout, no red.
 */
type FormMessageProps = React.HTMLAttributes<HTMLParagraphElement>;

export const FormMessage = React.forwardRef<HTMLParagraphElement, FormMessageProps>(
  function FormMessage({ className, children, ...props }, ref) {
    const { error, formMessageId } = useFormField();

    // Extract error message if error is an object with a message property.
    let errorMessage: unknown = null;
    if (error !== null && typeof error === 'object' && 'message' in error) {
      errorMessage = (error as Record<string, unknown>).message;
    }

    const body = (errorMessage ?? children) as React.ReactNode;

    // Only render a live region when an error is present.
    if (!body) {
      return null;
    }

    return (
      <p
        ref={ref}
        id={formMessageId}
        className={cn(
          'text-caption font-medium',
          error ? 'text-danger' : 'text-gray-dark',
          className,
        )}
        role={error ? 'alert' : undefined}
        {...props}
      >
        {body}
      </p>
    );
  },
);
FormMessage.displayName = 'FormMessage';
