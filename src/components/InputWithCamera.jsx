import { useState } from 'react'
import CameraCapture from './CameraCapture'

export default function InputWithCamera({
    value = '',
    onChange,
    onImageCapture,
    className = '',
    type = 'text',
    ...props
}) {
    const [isCameraOpen, setIsCameraOpen] = useState(false)

    // Handle closing the camera without capturing (or starting capture)
    const handleCloseCamera = () => {
        setIsCameraOpen(false)
    }

    const inputClass = 'w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg pl-4 pr-12 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30'

    return (
        <div className="relative flex items-center w-full">
            <input
                type={type}
                value={value}
                onChange={onChange}
                className={`${inputClass} ${className}`}
                {...props}
            />

            <button
                type="button"
                onClick={() => setIsCameraOpen(true)}
                className="absolute right-3 text-text-secondary hover:text-accent-gold transition-colors p-1"
                title="Capture with camera"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                </svg>
            </button>

            <CameraCapture
                open={isCameraOpen}
                onClose={handleCloseCamera}
                onCapture={(imageSrc) => {
                    if (onImageCapture) {
                        onImageCapture(imageSrc)
                    }
                    setIsCameraOpen(false)
                }}
            />
        </div>
    )
}
