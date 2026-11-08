import { useEffect, useId, useRef, type ReactNode } from 'react';
export default function ModalDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    id = useId();
  useEffect(() => {
    const dialog = ref.current!,
      previous = document.activeElement;
    dialog.showModal();
    heading.current?.focus({ preventScroll: true });
    dialog.scrollTop = 0;
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
      else document.querySelector<HTMLElement>('.live-table h1')?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="orbit-dialog"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id={id} ref={heading} tabIndex={-1}>
        {title}
      </h2>
      {children}
      <button onClick={onClose}>关闭</button>
    </dialog>
  );
}
