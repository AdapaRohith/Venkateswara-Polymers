import { useState, useRef, useCallback, useEffect } from 'react'

export default function CameraCapture({ open, onClose }) {
    const [mode, setMode] = useState(null) // null | 'camera' | 'upload'
    const [preview, setPreview] = useState(null)
    const [stream, setStream] = useState(null)
    const [cameraError, setCameraError] = useState(null)
    const videoRef = useRef(null)
    const canvasRef = useRef(null)
    const fileInputRef = useRef(null)

    // Stop camera stream helper
    const stopStream = useCallback(() => {
        if (stream) {
            stream.getTracks().forEach((t) => t.stop())
            setStream(null)
        }
    }, [stream])

    // Start camera
    const startCamera = useCallback(async () => {
        setCameraError(null)
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            })
            setStream(mediaStream)
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream
            }
        } catch (err) {
            setCameraError(
                err.name === 'NotAllowedError'
                    ? 'Camera access denied. Please allow camera permissions.'
                    : err.name === 'NotFoundError'
                        ? 'No camera found on this device.'
                        : `Camera error: ${err.message}`
            )
        }
    }, [])

    // When mode switches to camera, start it
    useEffect(() => {
        if (mode === 'camera') startCamera()
        return () => stopStream()
    }, [mode])

    // Assign stream to video element when ref and stream are ready
    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream
        }
    }, [stream])

    // Capture photo from video
    const capturePhoto = () => {
        const video = videoRef.current
        const canvas = canvasRef.current
        if (!video || !canvas) return

        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0)
        const dataUrl = canvas.toDataURL('image/png')
        setPreview(dataUrl)
        stopStream()
        setMode(null)
    }

    // Handle file upload
    const handleFileChange = (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
            setPreview(reader.result)
            setMode(null)
        }
        reader.readAsDataURL(file)
    }

    // Reset everything on close
    const handleClose = () => {
        stopStream()
        setMode(null)
        setPreview(null)
        setCameraError(null)
        onClose()
    }

    // Reset to choose again
    const handleRetake = () => {
        setPreview(null)
        setMode(null)
        setCameraError(null)
    }

    if (!open) return null

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={handleClose} />

            {/* Modal */}
            <div className="relative w-full max-w-lg bg-bg-card border border-border-default rounded-2xl shadow-2xl shadow-black/50 overflow-hidden animate-in">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border-default">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-accent-gold/10 flex items-center justify-center">
                            <svg className="w-4 h-4 text-accent-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                            </svg>
                        </div>
                        <h3 className="text-sm font-semibold text-text-primary tracking-wide">Capture Input</h3>
                    </div>
                    <button
                        onClick={handleClose}
                        className="text-text-secondary hover:text-text-primary p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="p-6">
                    {/* ── Preview Mode ── */}
                    {preview && (
                        <div className="space-y-4">
                            <div className="relative rounded-xl overflow-hidden border border-border-default bg-black">
                                <img src={preview} alt="Captured" className="w-full max-h-[400px] object-contain" />
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={handleRetake}
                                    className="flex-1 py-2.5 px-4 rounded-lg border border-border-default text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white/[0.03] transition-all"
                                >
                                    Retake
                                </button>
                                <button
                                    onClick={handleClose}
                                    className="flex-1 py-2.5 px-4 rounded-lg bg-accent-gold text-black text-sm font-semibold transition-all hover:bg-accent-gold-hover active:scale-[0.98]"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── Camera Mode ── */}
                    {!preview && mode === 'camera' && (
                        <div className="space-y-4">
                            {cameraError ? (
                                <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-6 text-center">
                                    <svg className="w-10 h-10 text-red-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                                    </svg>
                                    <p className="text-sm text-red-300">{cameraError}</p>
                                    <button onClick={handleRetake} className="mt-4 text-xs text-accent-gold hover:underline">
                                        ← Go back
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div className="relative rounded-xl overflow-hidden border border-border-default bg-black aspect-video">
                                        <video
                                            ref={videoRef}
                                            autoPlay
                                            playsInline
                                            muted
                                            className="w-full h-full object-cover"
                                        />
                                        {/* Viewfinder overlay */}
                                        <div className="absolute inset-0 pointer-events-none">
                                            <div className="absolute top-4 left-4 w-8 h-8 border-l-2 border-t-2 border-accent-gold/60 rounded-tl-lg" />
                                            <div className="absolute top-4 right-4 w-8 h-8 border-r-2 border-t-2 border-accent-gold/60 rounded-tr-lg" />
                                            <div className="absolute bottom-4 left-4 w-8 h-8 border-l-2 border-b-2 border-accent-gold/60 rounded-bl-lg" />
                                            <div className="absolute bottom-4 right-4 w-8 h-8 border-r-2 border-b-2 border-accent-gold/60 rounded-br-lg" />
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-center gap-4">
                                        <button
                                            onClick={handleRetake}
                                            className="py-2.5 px-5 rounded-lg border border-border-default text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white/[0.03] transition-all"
                                        >
                                            ← Back
                                        </button>
                                        <button
                                            onClick={capturePhoto}
                                            className="group relative w-16 h-16 rounded-full bg-accent-gold/10 border-2 border-accent-gold flex items-center justify-center transition-all hover:bg-accent-gold/20 active:scale-95"
                                        >
                                            <div className="w-12 h-12 rounded-full bg-accent-gold group-hover:bg-accent-gold-hover transition-colors" />
                                        </button>
                                        <div className="w-[74px]" /> {/* spacer to center capture btn */}
                                    </div>
                                </>
                            )}
                            <canvas ref={canvasRef} className="hidden" />
                        </div>
                    )}

                    {/* ── Choose Mode ── */}
                    {!preview && mode === null && (
                        <div className="space-y-3">
                            <p className="text-xs text-text-secondary/60 tracking-wide mb-4">
                                Choose an input method to capture or upload an image.
                            </p>
                            {/* Camera option */}
                            <button
                                onClick={() => setMode('camera')}
                                className="w-full flex items-center gap-4 p-4 rounded-xl border border-border-default hover:border-accent-gold/30 hover:bg-accent-gold/[0.03] transition-all group"
                            >
                                <div className="w-12 h-12 rounded-xl bg-accent-gold/10 flex items-center justify-center shrink-0 group-hover:bg-accent-gold/20 transition-colors">
                                    <svg className="w-6 h-6 text-accent-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                                    </svg>
                                </div>
                                <div className="text-left">
                                    <p className="text-sm font-medium text-text-primary">Use Camera</p>
                                    <p className="text-xs text-text-secondary/60 mt-0.5">Take a photo using your device camera</p>
                                </div>
                                <svg className="w-4 h-4 text-text-secondary/40 ml-auto group-hover:text-accent-gold transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                                </svg>
                            </button>

                            {/* Upload option */}
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full flex items-center gap-4 p-4 rounded-xl border border-border-default hover:border-emerald-500/30 hover:bg-emerald-500/[0.03] transition-all group"
                            >
                                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/20 transition-colors">
                                    <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                                    </svg>
                                </div>
                                <div className="text-left">
                                    <p className="text-sm font-medium text-text-primary">Upload Image</p>
                                    <p className="text-xs text-text-secondary/60 mt-0.5">Choose a photo from your device</p>
                                </div>
                                <svg className="w-4 h-4 text-text-secondary/40 ml-auto group-hover:text-emerald-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                                </svg>
                            </button>

                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleFileChange}
                                className="hidden"
                            />
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                @keyframes animate-in-keyframes {
                    from { opacity: 0; transform: scale(0.95) translateY(10px); }
                    to   { opacity: 1; transform: scale(1)    translateY(0);    }
                }
                .animate-in { animation: animate-in-keyframes 0.25s ease-out; }
            `}</style>
        </div>
    )
}
