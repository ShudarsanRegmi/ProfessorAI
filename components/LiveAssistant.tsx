import React, { useRef, useState, useEffect } from 'react';
import { Mic, MicOff, X, Activity } from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

const LiveAssistant: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState("Idle");
  const videoRef = useRef<HTMLVideoElement>(null); // For future video expansion
  const [volume, setVolume] = useState(0);

  // Refs for Audio Contexts and Processor
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Initialization for audio capture
  const initializeAudio = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      setStatus("Connecting...");
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const inputContext = inputAudioContextRef.current;
      const source = inputContext.createMediaStreamSource(stream);
      
      // Basic visualizer
      const analyzer = inputContext.createAnalyser();
      source.connect(analyzer);
      const dataArray = new Uint8Array(analyzer.frequencyBinCount);
      const updateVolume = () => {
        if (!isActive) return;
        analyzer.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setVolume(avg);
        requestAnimationFrame(updateVolume);
      };
      // Note: We don't start the loop here, we rely on isActive state later, 
      // but for simplicity we'll just let it be handled by the processor logic primarily.

      const processor = inputContext.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBlob = createBlob(inputData);
        if (sessionRef.current) {
          sessionRef.current.then(session => {
            session.sendRealtimeInput({ media: pcmBlob });
          });
        }
      };

      source.connect(processor);
      processor.connect(inputContext.destination);

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            setStatus("Listening");
            setIsActive(true);
            requestAnimationFrame(updateVolume);
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Handle Audio Output
            const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && audioContextRef.current) {
                const ctx = audioContextRef.current;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                
                const audioBuffer = await decodeAudioData(
                    decode(base64Audio),
                    ctx,
                    24000,
                    1
                );
                
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                
                sourcesRef.current.add(source);
                source.onended = () => sourcesRef.current.delete(source);
            }

            // Handle Interruption
            if (msg.serverContent?.interrupted) {
                sourcesRef.current.forEach(s => s.stop());
                sourcesRef.current.clear();
                nextStartTimeRef.current = 0;
            }
          },
          onclose: () => {
            setStatus("Disconnected");
            setIsActive(false);
          },
          onerror: (err) => {
            console.error(err);
            setStatus("Error");
            setIsActive(false);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: "You are a helpful teaching assistant. Help the professor create rubrics, understand student submissions, and manage the grading workflow. Be concise.",
          speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } }
          }
        }
      });

      sessionRef.current = sessionPromise;

    } catch (e) {
      console.error("Failed to initialize live session", e);
      setStatus("Error Accessing Mic");
    }
  };

  const disconnect = () => {
    // There is no explicit disconnect on the session object in the provided types, 
    // so we close contexts and rely on GC/component unmount or simple state management 
    // to stop sending data. In a real app, we'd signal the close.
    // For this demo, we stop the tracks.
    if (inputAudioContextRef.current) {
        inputAudioContextRef.current.close();
        inputAudioContextRef.current = null;
    }
    if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
    }
    sessionRef.current = null;
    setIsActive(false);
    setStatus("Idle");
  };

  // Helper functions for audio processing
  function createBlob(data: Float32Array) {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      int16[i] = data[i] * 32768;
    }
    const bytes = new Uint8Array(int16.buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const b64 = btoa(binary);

    return {
      data: b64,
      mimeType: 'audio/pcm;rate=16000',
    };
  }

  function decode(base64: string) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
     const dataInt16 = new Int16Array(data.buffer);
     const frameCount = dataInt16.length / numChannels;
     const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
     for(let c=0; c < numChannels; c++) {
         const channelData = buffer.getChannelData(c);
         for(let i=0; i<frameCount; i++) {
             channelData[i] = dataInt16[i*numChannels + c] / 32768.0;
         }
     }
     return buffer;
  }

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {isOpen ? (
        <div className="bg-white rounded-2xl shadow-2xl p-4 w-72 border border-indigo-100 flex flex-col items-center animate-in slide-in-from-bottom-5">
            <div className="w-full flex justify-between items-center mb-4">
                <span className="text-sm font-semibold text-slate-600 flex items-center gap-2">
                    <Activity className={`w-4 h-4 ${isActive ? 'text-green-500 animate-pulse' : 'text-slate-400'}`} />
                    {status}
                </span>
                <button onClick={() => { disconnect(); setIsOpen(false); }} className="text-slate-400 hover:text-slate-600">
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* Visualizer Placeholder */}
            <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mb-6 relative overflow-hidden">
                <div 
                    className="absolute bg-indigo-500 opacity-20 rounded-full transition-all duration-75"
                    style={{ width: `${30 + volume}px`, height: `${30 + volume}px` }}
                />
                <div 
                    className="absolute bg-indigo-500 opacity-40 rounded-full transition-all duration-75"
                    style={{ width: `${20 + (volume * 0.5)}px`, height: `${20 + (volume * 0.5)}px` }}
                />
                <Mic className="w-8 h-8 text-indigo-600 z-10" />
            </div>

            {!isActive ? (
                 <button 
                 onClick={initializeAudio}
                 className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded-lg font-medium transition-colors"
                >
                 Start Conversation
                </button>
            ) : (
                <button 
                 onClick={disconnect}
                 className="w-full bg-red-50 hover:bg-red-100 text-red-600 py-2 px-4 rounded-lg font-medium transition-colors"
                >
                 End Session
                </button>
            )}
           
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-full shadow-lg transition-transform hover:scale-110 flex items-center justify-center"
        >
          <Mic className="w-6 h-6" />
        </button>
      )}
    </div>
  );
};

export default LiveAssistant;
