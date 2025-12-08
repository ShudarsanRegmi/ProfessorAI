import React, { useState, useRef } from 'react';
import { Mic, StopCircle, FileText, Loader2 } from 'lucide-react';
import { transcribeAudioNote } from '../services/geminiService';

interface AudioNotesProps {
  onTranscription: (text: string) => void;
}

const AudioNotes: React.FC<AudioNotesProps> = ({ onTranscription }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      chunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await processAudio(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processAudio = async (blob: Blob) => {
    setIsProcessing(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64Data = reader.result as string;
        const base64Content = base64Data.split(',')[1];
        const text = await transcribeAudioNote(base64Content, 'audio/webm');
        onTranscription(text);
        setIsProcessing(false);
      };
    } catch (e) {
      console.error(e);
      setIsProcessing(false);
      alert("Failed to transcribe audio.");
    }
  };

  return (
    <div className="flex flex-col gap-2 mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
      <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
        <FileText className="w-4 h-4" />
        Dictate Rubric or Notes
      </h3>
      <div className="flex gap-2">
        {!isRecording ? (
          <button
            onClick={startRecording}
            disabled={isProcessing}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 rounded-md text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <Mic className="w-4 h-4 text-slate-600" />
            Start Recording
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-600 hover:bg-red-100 animate-pulse"
          >
            <StopCircle className="w-4 h-4" />
            Stop Recording
          </button>
        )}
        {isProcessing && (
           <span className="flex items-center gap-2 text-sm text-indigo-600">
             <Loader2 className="w-4 h-4 animate-spin" />
             Transcribing with Gemini Flash...
           </span>
        )}
      </div>
    </div>
  );
};

export default AudioNotes;
