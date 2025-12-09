import React, { useState } from 'react';
import { 
  BookOpen, 
  Upload, 
  GraduationCap, 
  CheckCircle, 
  Search, 
  AlertCircle,
  FileText,
  ChevronRight,
  BarChart2,
  Cpu,
  Loader2,
  Github,
  ExternalLink,
  Code
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

import LiveAssistant from './components/LiveAssistant';
import AudioNotes from './components/AudioNotes';
import { generateRubricFromText, evaluateSubmission, checkFacts, analyzeCodeRepository } from './services/geminiService';
import { AssignmentState, Rubric, StudentSubmission, GroundingResult, CodeAnalysis } from './types';

const App: React.FC = () => {
  // --- State ---
  const [activeTab, setActiveTab] = useState<'setup' | 'rubric' | 'grading' | 'results'>('setup');
  
  const [assignment, setAssignment] = useState<AssignmentState>({
    title: "",
    questionText: "",
    questionFile: null,
    questionMimeType: null,
    rubricText: "",
    structuredRubric: null
  });

  const [submissions, setSubmissions] = useState<StudentSubmission[]>([]);
  const [isGeneratingRubric, setIsGeneratingRubric] = useState(false);
  const [factCheckQuery, setFactCheckQuery] = useState("");
  const [groundingResult, setGroundingResult] = useState<GroundingResult | null>(null);
  const [isFactChecking, setIsFactChecking] = useState(false);

  // --- Handlers ---

  const handleAssignmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        setAssignment(prev => ({ 
            ...prev, 
            questionFile: base64, 
            questionMimeType: file.type,
            title: file.name
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerateRubric = async () => {
    if (!assignment.rubricText && !assignment.questionText) return;
    setIsGeneratingRubric(true);
    try {
      const rubric = await generateRubricFromText(assignment.rubricText, {
        text: assignment.questionText,
        fileData: assignment.questionFile || undefined,
        mimeType: assignment.questionMimeType || undefined
      });
      setAssignment(prev => ({ ...prev, structuredRubric: rubric }));
      setActiveTab('rubric');
    } catch (error) {
      console.error(error);
      alert("Failed to generate rubric.");
    } finally {
      setIsGeneratingRubric(false);
    }
  };

  const handleSubmissionUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const newSubmissions: StudentSubmission[] = Array.from(files).map((file, idx) => ({
        id: `S-${Date.now()}-${idx}`,
        filename: (file as unknown as File).name,
        fileData: "", // Will be loaded
        mimeType: (file as unknown as File).type,
        status: 'pending'
      }));

      // In a real app we would not load all into memory at once, but for this demo we pre-load base64
      const promises = Array.from(files).map((file, idx) => {
        return new Promise<void>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                newSubmissions[idx].fileData = (reader.result as string).split(',')[1];
                resolve();
            };
            reader.readAsDataURL(file as unknown as File);
        });
      });

      Promise.all(promises).then(() => {
          setSubmissions(prev => [...prev, ...newSubmissions]);
      });
    }
  };

  const runEvaluation = async (submission: StudentSubmission) => {
    if (!assignment.structuredRubric) return;
    
    // 1. Initial Document Evaluation
    setSubmissions(prev => prev.map(s => s.id === submission.id ? { ...s, status: 'evaluating' } : s));

    try {
      const result = await evaluateSubmission(
        submission.fileData,
        submission.mimeType,
        {
          text: assignment.questionText,
          fileData: assignment.questionFile || undefined,
          mimeType: assignment.questionMimeType || undefined
        },
        assignment.structuredRubric
      );

      // Check for Code Links
      const codeLinks = result.external_links?.filter(l => 
        l.includes('github.com') || l.includes('gitlab.com') || l.includes('colab.research.google.com')
      );

      if (codeLinks && codeLinks.length > 0) {
        // 2. Secondary Code Analysis
        setSubmissions(prev => prev.map(s => s.id === submission.id ? { 
            ...s, 
            status: 'analyzing_code', 
            evaluation: result 
        } : s));

        try {
          // Analyze the first code link found (for this demo)
          const codeAnalysis = await analyzeCodeRepository(codeLinks[0], assignment.structuredRubric);
          result.code_analysis = codeAnalysis;
        } catch (codeErr) {
           console.error("Code analysis failed but main grading succeeded", codeErr);
        }
      }

      setSubmissions(prev => prev.map(s => s.id === submission.id ? { 
          ...s, 
          status: 'graded', 
          evaluation: result 
      } : s));

    } catch (error) {
      console.error(error);
      setSubmissions(prev => prev.map(s => s.id === submission.id ? { ...s, status: 'error' } : s));
    }
  };

  const handleFactCheck = async () => {
      if(!factCheckQuery) return;
      setIsFactChecking(true);
      try {
          const res = await checkFacts(factCheckQuery);
          setGroundingResult(res);
      } catch (e) {
          console.error(e);
      } finally {
          setIsFactChecking(false);
      }
  }

  // --- Render Helpers ---

  const renderSteps = () => (
    <div className="flex border-b border-slate-200 bg-white px-6">
      {[
        { id: 'setup', icon: BookOpen, label: 'Assignment & Setup' },
        { id: 'rubric', icon: CheckCircle, label: 'Rubric Review' },
        { id: 'grading', icon: GraduationCap, label: 'Upload & Grade' },
        { id: 'results', icon: BarChart2, label: 'Results' },
      ].map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id as any)}
          className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
            activeTab === tab.id
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <tab.icon className="w-4 h-4" />
          {tab.label}
        </button>
      ))}
    </div>
  );

  const renderSetup = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-600" />
            1. Assignment Definition
        </h2>
        
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Assignment Title</label>
                <input 
                    type="text" 
                    className="w-full border border-slate-300 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 outline-none" 
                    placeholder="e.g. Advanced Calculus Midterm"
                    value={assignment.title}
                    onChange={e => setAssignment({...assignment, title: e.target.value})}
                />
            </div>
            
            <div>
                 <label className="block text-sm font-medium text-slate-700 mb-1">Upload Question (PDF)</label>
                 <input 
                    type="file" 
                    accept="application/pdf"
                    onChange={handleAssignmentUpload}
                    className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                 />
                 {assignment.questionFile && <p className="text-xs text-green-600 mt-1">PDF Loaded</p>}
            </div>

            <div className="relative">
                <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-slate-500">OR</span>
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Paste Question Text</label>
                <textarea 
                    className="w-full border border-slate-300 rounded-lg p-2 h-32 focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="Type the question directly here..."
                    value={assignment.questionText}
                    onChange={e => setAssignment({...assignment, questionText: e.target.value})}
                />
            </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-indigo-600" />
            2. Rubric Definition
        </h2>
        <p className="text-sm text-slate-500 mb-4">Describe how this assignment should be graded. Gemini will convert this into a structured scoring matrix.</p>
        
        <textarea 
            className="flex-1 w-full border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
            placeholder="e.g. 5 points for correct formula usage, 3 points for graph labeling. Code must compile. Deduct marks for missing units..."
            value={assignment.rubricText}
            onChange={e => setAssignment({...assignment, rubricText: e.target.value})}
        />

        <AudioNotes onTranscription={(text) => setAssignment(prev => ({ ...prev, rubricText: prev.rubricText + " " + text }))} />

        <button 
            onClick={handleGenerateRubric}
            disabled={isGeneratingRubric || (!assignment.rubricText && !assignment.questionText)}
            className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
        >
            {isGeneratingRubric ? <Loader2 className="animate-spin w-4 h-4"/> : <Cpu className="w-4 h-4" />}
            Generate Structured Rubric
        </button>
      </div>
    </div>
  );

  const renderRubric = () => (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
            <h2 className="text-xl font-semibold text-slate-800">Review Evaluation Criteria</h2>
            <button onClick={() => setActiveTab('grading')} className="text-indigo-600 hover:text-indigo-800 font-medium text-sm flex items-center gap-1">
                Confirm & Proceed <ChevronRight className="w-4 h-4" />
            </button>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
                    <tr>
                        <th className="p-4 border-b">Criterion</th>
                        <th className="p-4 border-b">Weight</th>
                        <th className="p-4 border-b">Max Score</th>
                        <th className="p-4 border-b hidden md:table-cell">Good Performance</th>
                        <th className="p-4 border-b hidden md:table-cell">Poor Performance</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {assignment.structuredRubric?.criteria?.map((c, i) => (
                        <tr key={i} className="hover:bg-slate-50/50">
                            <td className="p-4 font-medium text-slate-900">{c.name}</td>
                            <td className="p-4 text-slate-500">{c.weight}</td>
                            <td className="p-4 text-slate-500">{c.max_score}</td>
                            <td className="p-4 text-slate-500 text-sm hidden md:table-cell">{c.good_performance}</td>
                            <td className="p-4 text-slate-500 text-sm hidden md:table-cell">{c.poor_performance}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {(!assignment.structuredRubric || !assignment.structuredRubric.criteria || assignment.structuredRubric.criteria.length === 0) && (
                <div className="p-12 text-center text-slate-400">
                    No rubric generated yet or rubric is empty. Go back to Setup.
                </div>
            )}
        </div>
    </div>
  );

  const renderCodeAnalysis = (analysis: CodeAnalysis) => (
    <div className="mt-4 bg-slate-900 text-slate-200 rounded-lg p-4 border border-slate-700">
        <div className="flex items-start justify-between mb-4 border-b border-slate-700 pb-3">
            <div>
                <h4 className="text-sm font-semibold text-indigo-400 flex items-center gap-2">
                    <Code className="w-4 h-4" />
                    Deep Code Analysis
                </h4>
                <a href={analysis.repo_url} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 mt-1">
                    <Github className="w-3 h-3" />
                    {analysis.repo_url}
                </a>
            </div>
            <div className="text-right">
                <span className="block text-xl font-bold text-green-400">{analysis.implementation_score} / {analysis.max_score}</span>
                <span className="text-xs text-slate-500">Implementation Score</span>
            </div>
        </div>

        <p className="text-sm text-slate-300 mb-4">{analysis.summary}</p>

        {analysis.evidence && analysis.evidence.length > 0 && (
            <div className="space-y-3">
                <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Evidence & Citations</h5>
                {analysis.evidence.map((ev, i) => (
                    <div key={i} className="bg-slate-800 rounded p-3 border border-slate-700">
                        <div className="flex justify-between text-xs text-indigo-300 mb-2">
                            <span className="font-mono">{ev.file}</span>
                            <span>Line(s): {ev.line_numbers}</span>
                        </div>
                        {ev.snippet && (
                             <div className="bg-slate-950 p-2 rounded mb-2 overflow-x-auto">
                                <pre className="text-xs font-mono text-slate-300">{ev.snippet}</pre>
                             </div>
                        )}
                        <p className="text-xs text-slate-400 italic">"{ev.comment}"</p>
                    </div>
                ))}
            </div>
        )}
        
        {analysis.status === 'failed' && (
             <div className="mt-2 text-xs text-red-400 bg-red-900/20 p-2 rounded">
                Analysis encountered an error: {analysis.error_message || "Unknown error"}. Scores may be tentative.
             </div>
        )}
    </div>
  );

  const renderGrading = () => (
    <div className="space-y-6">
        {/* Actions Bar */}
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between bg-white p-4 rounded-xl border border-slate-200">
             <div>
                 <h2 className="font-semibold text-slate-800">Student Submissions</h2>
                 <p className="text-sm text-slate-500">{submissions.length} files uploaded</p>
             </div>
             <div className="flex gap-2">
                <label className="cursor-pointer bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 py-2 px-4 rounded-lg text-sm font-medium flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    Upload PDFs
                    <input type="file" multiple accept="application/pdf" className="hidden" onChange={handleSubmissionUpload} />
                </label>
                <button 
                    onClick={() => submissions.filter(s => s.status === 'pending').forEach(runEvaluation)}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded-lg text-sm font-medium flex items-center gap-2"
                >
                    <GraduationCap className="w-4 h-4" />
                    Grade All Pending
                </button>
             </div>
        </div>

        {/* Fact Checker */}
        <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl flex flex-col md:flex-row gap-4 items-start">
             <div className="flex-1 w-full">
                <label className="text-xs font-bold text-indigo-800 uppercase tracking-wide mb-1 block">Quick Fact Check (Google Search)</label>
                <div className="flex gap-2">
                    <input 
                        type="text" 
                        value={factCheckQuery}
                        onChange={e => setFactCheckQuery(e.target.value)}
                        placeholder="e.g. Verify the date of the Battle of Hastings..."
                        className="flex-1 border border-indigo-200 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <button 
                        onClick={handleFactCheck}
                        disabled={isFactChecking}
                        className="bg-indigo-600 text-white px-3 py-1.5 rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                       {isFactChecking ? <Loader2 className="w-4 h-4 animate-spin"/> : <Search className="w-4 h-4" />}
                    </button>
                </div>
                {groundingResult && (
                    <div className="mt-3 bg-white p-3 rounded border border-indigo-100 text-sm">
                        <p className="text-slate-800 mb-2">{groundingResult.text}</p>
                        <div className="flex flex-wrap gap-2">
                            {groundingResult.sources?.map((s, i) => (
                                <a key={i} href={s.uri} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div> {s.title}
                                </a>
                            ))}
                        </div>
                    </div>
                )}
             </div>
        </div>

        {/* Submissions Grid */}
        <div className="grid grid-cols-1 gap-4">
            {submissions.map((sub) => (
                <div key={sub.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                    <div className="p-4 flex items-center justify-between border-b border-slate-50 bg-slate-50/50">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-slate-200 rounded text-slate-600">
                                <FileText className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="font-medium text-slate-900">{sub.filename}</h3>
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                        sub.status === 'graded' ? 'bg-green-100 text-green-700' :
                                        sub.status === 'evaluating' || sub.status === 'analyzing_code' ? 'bg-amber-100 text-amber-700' :
                                        sub.status === 'error' ? 'bg-red-100 text-red-700' :
                                        'bg-slate-100 text-slate-600'
                                    }`}>
                                        {sub.status === 'analyzing_code' ? 'Checking Code...' : sub.status.toUpperCase()}
                                    </span>
                                    
                                    {/* Link Indicators */}
                                    {sub.evaluation?.external_links && sub.evaluation.external_links.length > 0 && (
                                        <div className="flex gap-1">
                                            {sub.evaluation.external_links.map((link, i) => (
                                                <a 
                                                    key={i} 
                                                    href={link} 
                                                    target="_blank" 
                                                    rel="noreferrer"
                                                    title={link}
                                                    className="p-1 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500"
                                                >
                                                    {link.includes('github') ? <Github className="w-3 h-3"/> : <ExternalLink className="w-3 h-3"/>}
                                                </a>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        {sub.status === 'graded' ? (
                            <div className="text-right">
                                <span className="block text-2xl font-bold text-indigo-600">{sub.evaluation?.final_score}</span>
                                <span className="text-xs text-slate-500">Total Score</span>
                            </div>
                        ) : sub.status === 'pending' || sub.status === 'error' ? (
                            <button 
                                onClick={() => runEvaluation(sub)}
                                className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                            >
                                Evaluate
                            </button>
                        ) : (
                            <div className="flex items-center gap-2 text-amber-600 text-sm">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {sub.status === 'analyzing_code' ? 'Analyzing Code Repo...' : 'Evaluating PDF...'}
                            </div>
                        )}
                    </div>
                    {sub.evaluation && (
                        <div className="p-4">
                             <div className="mb-4">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Overall Feedback</h4>
                                <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100">
                                    {sub.evaluation.overall_feedback}
                                </p>
                             </div>
                             {sub.evaluation.missing_concepts && sub.evaluation.missing_concepts.length > 0 && (
                                <div className="mb-4">
                                    <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2">Missing Concepts</h4>
                                    <ul className="list-disc list-inside text-sm text-red-600">
                                        {sub.evaluation.missing_concepts.map((m, i) => <li key={i}>{m}</li>)}
                                    </ul>
                                </div>
                             )}
                             <div>
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Criteria Breakdown</h4>
                                <div className="space-y-2">
                                    {sub.evaluation.criteria?.map((c, i) => (
                                        <div key={i} className="flex justify-between items-start text-sm border-b border-slate-50 pb-2 last:border-0">
                                            <div className="flex-1 pr-4">
                                                <span className="font-medium text-slate-800 block">{c.name}</span>
                                                <span className="text-slate-500 text-xs">{c.comment}</span>
                                            </div>
                                            <div className="font-semibold text-slate-700 whitespace-nowrap">
                                                {c.score} / {c.max_score}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                             </div>

                             {/* Code Analysis Component */}
                             {sub.evaluation.code_analysis && renderCodeAnalysis(sub.evaluation.code_analysis)}
                        </div>
                    )}
                </div>
            ))}
            {submissions.length === 0 && (
                <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl">
                    <Upload className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500">No submissions uploaded yet.</p>
                </div>
            )}
        </div>
    </div>
  );

  const renderResults = () => {
      const gradedData = submissions
        .filter(s => s.status === 'graded' && s.evaluation)
        .map(s => ({
            name: s.filename.slice(0, 10) + '...',
            score: s.evaluation?.final_score || 0
        }));

      return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                 {/* Chart */}
                 <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h2 className="text-lg font-semibold mb-6">Score Distribution</h2>
                    <div className="h-64 w-full">
                        {gradedData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={gradedData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} />
                                    <YAxis axisLine={false} tickLine={false} />
                                    <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                    <Bar dataKey="score" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-slate-400">
                                No graded data to display
                            </div>
                        )}
                    </div>
                 </div>

                 {/* Stats */}
                 <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h2 className="text-lg font-semibold mb-4">Summary</h2>
                    <div className="space-y-4">
                        <div className="p-4 bg-indigo-50 rounded-lg">
                            <span className="text-sm text-indigo-600 font-medium">Average Score</span>
                            <div className="text-3xl font-bold text-indigo-900">
                                {gradedData.length > 0 
                                    ? (gradedData.reduce((acc, curr) => acc + curr.score, 0) / gradedData.length).toFixed(1) 
                                    : '-'}
                            </div>
                        </div>
                        <div className="p-4 bg-green-50 rounded-lg">
                            <span className="text-sm text-green-600 font-medium">Graded</span>
                            <div className="text-3xl font-bold text-green-900">
                                {gradedData.length} / {submissions.length}
                            </div>
                        </div>
                    </div>
                 </div>
            </div>
        </div>
      );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Sidebar for Desktop / Header for Mobile could be added here, keeping it simple */}
      
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-8">
        <header className="mb-8">
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">ProfessorAI</h1>
            <p className="text-slate-500 mt-1">Intelligent Assignment Evaluation & Feedback System</p>
        </header>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[600px]">
            {renderSteps()}
            <div className="p-6 md:p-8 bg-slate-50/30 min-h-[500px]">
                {activeTab === 'setup' && renderSetup()}
                {activeTab === 'rubric' && renderRubric()}
                {activeTab === 'grading' && renderGrading()}
                {activeTab === 'results' && renderResults()}
            </div>
        </div>
      </main>

      <LiveAssistant />
    </div>
  );
};

export default App;