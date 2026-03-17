export default function InputWithCamera({ className, ...props }) {
  const baseClass =
    'w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30'

  return (
    <input
      className={className ? `${baseClass} ${className}` : baseClass}
      {...props}
    />
  )
}
