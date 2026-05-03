/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  doc,
  updateDoc,
  limit,
  getDocFromServer
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged,
  User,
  signOut,
  signInAnonymously,
  updateProfile
} from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { Tv, Send, LogIn, LogOut, Check, Home, User as UserIcon, History, BarChart3, Clock } from 'lucide-react';
import { db, auth, handleFirestoreError, OperationType } from './lib/firebase';

// Types
interface Message {
  id: string;
  text: string;
  createdAt: any;
  resolvedAt?: any;
  active: boolean;
  senderName?: string;
  station: string;
  itemCount?: number | null;
}

const TvElapsedTime = ({ createdAt, onStatusChange }: { createdAt: any, onStatusChange: (status: 'normal' | 'warning' | 'critical') => void }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!createdAt) return;

    const calculateElapsed = () => {
      const ms = typeof createdAt.toMillis === 'function' ? createdAt.toMillis() : Date.now();
      const diff = Math.floor((Date.now() - ms) / 1000);
      setElapsed(diff > 0 ? diff : 0);
      
      if (diff >= 300) { // 5 mins
        onStatusChange('critical');
      } else if (diff >= 120) { // 2 mins
        onStatusChange('warning');
      } else {
        onStatusChange('normal');
      }
    };

    calculateElapsed();
    const interval = setInterval(calculateElapsed, 1000);
    return () => clearInterval(interval);
  }, [createdAt, onStatusChange]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] font-black uppercase tracking-[0.5em] text-black/40 mb-2">TEMPO DECORRIDO</span>
      <span className="text-5xl font-mono font-bold tracking-tighter text-[#7A1E6C]">
        {minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}
      </span>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'control' | 'tv' | 'history'>('control');
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyMessages, setHistoryMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [itemCount, setItemCount] = useState<number | ''>('');
  const [isSending, setIsSending] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [selectedStation, setSelectedStation] = useState('Farmácia UTI');
  const [tvStation, setTvStation] = useState<string | 'ALL'>(() => {
    return localStorage.getItem('farma_tv_station') || 'ALL';
  });
  const [tvStatus, setTvStatus] = useState<'normal' | 'warning' | 'critical'>('normal');
  const [prevTvStatus, setPrevTvStatus] = useState<'normal' | 'warning' | 'critical'>('normal');
  const [lastPlayedId, setLastPlayedId] = useState<string | null>(null);
  const [tvMessageIndex, setTvMessageIndex] = useState(0);

  useEffect(() => {
    if (mode === 'tv' && messages.length > 1) {
      const interval = setInterval(() => {
        setTvMessageIndex((prev) => (prev + 1) % messages.length);
      }, 7000); // cycle every 7 seconds
      return () => clearInterval(interval);
    }
  }, [messages.length, mode]);

  useEffect(() => {
    if (tvMessageIndex >= messages.length) {
      setTvMessageIndex(0);
    }
  }, [messages.length, tvMessageIndex]);

  // Random names list
  const stations = ['Farmácia UTI', 'Farmácia PS', 'Farmácia CC'];
  const randomNames = ['Visitante Silencioso', 'Chefe do Andar', 'Vizinho de Cima', 'Mensageiro Digital', 'Voz do Além', 'Capitão Intercom'];

  // Auth connection test and listener
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Listen for active messages
  useEffect(() => {
    if (!user) {
      setMessages([]);
      return;
    }

    const constraints = [
      where('active', '==', true),
      orderBy('createdAt', 'desc')
    ];

    if (mode === 'tv' && tvStation !== 'ALL') {
      constraints.push(where('station', '==', tvStation));
    }

    const q = query(
      collection(db, 'messages'),
      ...constraints,
      limit(10) 
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Message[];
      setMessages(msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'messages');
    });

    return () => unsubscribe();
  }, [user, mode]);

  // Listen for history
  useEffect(() => {
    if (!user || mode !== 'history') return;

    const q = query(
      collection(db, 'messages'),
      where('active', '==', false),
      orderBy('resolvedAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Message[];
      setHistoryMessages(msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'messages/history');
    });

    return () => unsubscribe();
  }, [user, mode]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGuestLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = guestName.trim() || randomNames[Math.floor(Math.random() * randomNames.length)];
    
    setIsLoggingIn(true);
    try {
      const credentials = await signInAnonymously(auth);
      await updateProfile(credentials.user, {
        displayName: finalName
      });
    } catch (error: any) {
      console.error("Guest login failed", error);
      if (error.code === 'auth/admin-restricted-operation') {
        alert("Atenção: O 'Login Anônimo' precisa ser ativado no Firebase Console!\n\n1. Vá em Authentication > Sign-in method\n2. Ative o provedor 'Anônimo'\n3. Salve e tente novamente.");
      } else {
        alert("Erro ao entrar: " + error.message);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !user) return;

    setIsSending(true);
    try {
      await addDoc(collection(db, 'messages'), {
        text: inputText,
        itemCount: itemCount === '' ? null : itemCount,
        createdAt: serverTimestamp(),
        active: true,
        senderName: user.displayName || 'Anônimo',
        station: selectedStation
      });
      setInputText('');
      setItemCount('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'messages');
    } finally {
      setIsSending(false);
    }
  };

  const deactivateMessage = async (id: string) => {
    try {
      await updateDoc(doc(db, 'messages', id), {
        active: false,
        resolvedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `messages/${id}`);
    }
  };

  const averageResponseTime = useCallback(() => {
    const messagesWithTime = historyMessages.filter(m => m.createdAt && m.resolvedAt);
    if (messagesWithTime.length === 0) return 0;
    
    const totalTime = messagesWithTime.reduce((acc, m) => {
      const start = m.createdAt.toMillis();
      const end = m.resolvedAt.toMillis();
      return acc + (end - start);
    }, 0);
    
    return totalTime / messagesWithTime.length / 1000 / 60; // Minutes
  }, [historyMessages]);

  const playAlertSound = useCallback((type: 'new' | 'warning' | 'critical' | 'resolved' = 'new') => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const audioCtx = new AudioContext();
      
      const playTone = (freq1: number, freq2: number | null, typeWave: OscillatorType, timeOffset: number, duration: number, vol = 0.3) => {
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        oscillator.type = typeWave;
        oscillator.frequency.setValueAtTime(freq1, audioCtx.currentTime + timeOffset);
        if (freq2) {
          oscillator.frequency.setValueAtTime(freq2, audioCtx.currentTime + timeOffset + (duration * 0.5));
        }
        
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime + timeOffset);
        gainNode.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + timeOffset + (duration * 0.1));
        gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + timeOffset + duration);
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        oscillator.start(audioCtx.currentTime + timeOffset);
        oscillator.stop(audioCtx.currentTime + timeOffset + duration);
      };

      if (type === 'new') {
        playTone(880, 1108.73, 'triangle', 0, 0.2);
        playTone(880, 1108.73, 'triangle', 0.3, 0.2);
        playTone(880, 1108.73, 'triangle', 0.6, 0.2);
      } else if (type === 'warning') {
        playTone(440, null, 'square', 0, 0.15, 0.05);
        playTone(330, null, 'square', 0.2, 0.4, 0.05);
      } else if (type === 'critical') {
        playTone(800, null, 'sawtooth', 0, 0.1, 0.1);
        playTone(600, null, 'sawtooth', 0.1, 0.1, 0.1);
        playTone(800, null, 'sawtooth', 0.2, 0.1, 0.1);
        playTone(600, null, 'sawtooth', 0.3, 0.1, 0.1);
        playTone(800, null, 'sawtooth', 0.4, 0.4, 0.1);
      } else if (type === 'resolved') {
        playTone(523.25, null, 'sine', 0, 0.15, 0.1);
        playTone(659.25, null, 'sine', 0.15, 0.15, 0.1);
        playTone(783.99, null, 'sine', 0.3, 0.4, 0.1);
      }
    } catch (e) {
      console.error("Audio API not supported or user hasn't interacted yet", e);
    }
  }, []);

  useEffect(() => {
    if (mode === 'tv') {
      if (tvStatus !== prevTvStatus) {
        if (tvStatus === 'warning') {
          playAlertSound('warning');
        } else if (tvStatus === 'critical') {
          playAlertSound('critical');
        } else if (tvStatus === 'normal' && prevTvStatus !== 'normal') {
          // If went back to normal, maybe it was resolved
          if (messages.length === 0) {
            playAlertSound('resolved');
          }
        }
        setPrevTvStatus(tvStatus);
      }
    }
  }, [tvStatus, prevTvStatus, mode, playAlertSound, messages.length]);

  useEffect(() => {
    if (mode === 'tv' && messages.length > 0) {
      const currentMessage = messages[0];
      if (currentMessage.id !== lastPlayedId) {
        playAlertSound('new');
        setLastPlayedId(currentMessage.id);
      }
    } else if (mode === 'tv' && messages.length === 0) {
      setTvStatus('normal');
    }
  }, [messages, mode, lastPlayedId, playAlertSound]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#7A1E6C] text-white font-mono">
        <div className="flex flex-col items-center gap-4">
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="w-12 h-12 border-2 border-white/5 border-t-white rounded-full bg-white/5 backdrop-blur-sm"
          />
          <span className="text-[10px] uppercase tracking-[0.3em] opacity-40">Inicializando Sistema</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#E6E6E6] flex flex-col items-center justify-center p-6 font-sans">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-[#7A1E6C] p-8 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] text-white border border-white/5"
        >
          <div className="text-center mb-10">
            <div className="w-20 h-20 bg-white/5 border border-white/10 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
              <Tv className="text-white w-10 h-10" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">FARMA.TV</h1>
            <p className="text-white/40 text-sm">Painel de comunicação inteligente</p>
          </div>

          <form onSubmit={handleGuestLogin} className="space-y-5 mb-10">
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest font-bold text-white/30 ml-1">Identificação para a TV</label>
              <input 
                type="text" 
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Seu nome..."
                className="w-full p-4 bg-white/5 border border-white/10 rounded-2xl focus:outline-none focus:ring-4 focus:ring-white/5 focus:border-white/20 transition-all font-medium text-white placeholder:text-white/10"
              />
            </div>
            <button 
              type="submit"
              disabled={isLoggingIn}
              className="w-full flex items-center justify-center gap-3 bg-white text-black py-4 px-6 rounded-2xl hover:bg-neutral-200 transition-all font-bold group"
            >
              <span className="group-active:scale-95 transition-transform">
                {isLoggingIn ? 'CONECTANDO...' : 'ENTRAR COMO VISITANTE'}
              </span>
            </button>
          </form>

          <div className="relative mb-10">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-white/5"></span>
            </div>
            <div className="relative flex justify-center text-[10px]">
              <span className="bg-[#7A1E6C] px-3 text-white/20 font-bold uppercase tracking-widest">Acesso Administrativo</span>
            </div>
          </div>

          <button 
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="w-full flex items-center justify-center gap-3 border border-white/10 bg-white/5 text-white/80 py-4 px-6 rounded-2xl hover:bg-white/10 transition-all font-medium"
          >
            <LogIn size={20} className="opacity-40" />
            Vincular Conta Google
          </button>
        </motion.div>
        
        <p className="mt-8 text-[10px] uppercase tracking-[0.4em] text-black/20 font-bold">Protocolo Seguro v2.4</p>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-colors duration-1000 ${mode === 'tv' ? 'bg-white overflow-hidden text-black' : 'bg-[#E6E6E6] font-sans'}`}>
      
      {/* Dynamic Navigation */}
      <nav className={`fixed bottom-6 md:top-8 md:bottom-auto left-1/2 -translate-x-1/2 z-50 flex items-center overflow-x-auto w-[95vw] md:w-auto p-2 md:p-1.5 rounded-3xl md:rounded-full border transition-all duration-700 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] ${mode === 'tv' ? 'bg-black/5 border-black/10 opacity-0 hover:opacity-100 backdrop-blur-xl shadow-lg' : 'bg-black/95 md:bg-black/90 border-black/10 shadow-2xl'}`}>
        <div className="flex items-center gap-1 shrink-0">
          {stations.map(s => (
            <button 
              key={s}
              onClick={() => {
                setMode('control');
                setSelectedStation(s);
              }}
              className={`flex items-center whitespace-nowrap gap-2 px-4 py-2.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${mode === 'control' && selectedStation === s ? 'bg-white text-black shadow-lg scale-105' : 'text-neutral-500 hover:text-white'}`}
            >
              {s.replace('Farmácia ', '')}
            </button>
          ))}
        </div>
        
        <div className="w-[1px] h-4 bg-white/10 mx-2 shrink-0" />

        <div className="flex items-center gap-1 shrink-0">
          <button 
            onClick={() => setMode('history')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest transition-all whitespace-nowrap ${mode === 'history' ? 'bg-white text-black shadow-lg scale-105' : 'text-neutral-500 hover:text-white'}`}
          >
            <History size={14} />
            <span className="hidden sm:inline">Histórico</span>
          </button>
          <button 
            onClick={() => setMode('tv')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest transition-all whitespace-nowrap ${mode === 'tv' ? 'bg-white text-black shadow-lg scale-105' : 'text-neutral-500 hover:text-white'}`}
          >
            <Tv size={14} />
            <span className="hidden sm:inline">Modo TV</span>
          </button>
          <div className="w-[1px] h-4 bg-white/10 mx-2 shrink-0" />
          <button 
            onClick={() => signOut(auth)}
            className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full text-white/30 hover:text-red-500 hover:bg-red-500/10 transition-all"
            title="Sair"
          >
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      <AnimatePresence mode="wait">
        {mode === 'control' ? (
          <motion.main 
            key="control"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            className="max-w-2xl mx-auto pt-10 md:pt-32 pb-32 md:pb-20 px-4 md:px-6 w-full"
          >
            <div className="bg-[#7A1E6C] rounded-[2rem] md:rounded-[40px] p-6 md:p-12 shadow-2xl border border-white/5 overflow-hidden relative">
              <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]" />
              
              <header className="mb-10 relative z-10">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-2 h-2 rounded-full bg-[#7AC143] animate-pulse shadow-[0_0_8px_rgba(122,193,67,0.6)]" />
                  <span className="text-[10px] uppercase tracking-[0.4em] font-bold text-white/30">Sistema Online / Pronto @ {selectedStation}</span>
                </div>
                <h2 className="text-4xl md:text-5xl font-black text-white tracking-tighter mb-4 italic uppercase break-words">{selectedStation.replace('Farmácia ', '')}</h2>
              </header>

              <form onSubmit={handleSendMessage} className="relative mb-12 z-10">
                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 transition-all focus-within:border-white/20 focus-within:bg-white/[0.08]">
                  <textarea 
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="AVISO PARA A FARMÁCIA CENTRAL..."
                    className="w-full min-h-[140px] bg-transparent text-white text-2xl font-bold p-0 resize-none focus:outline-none placeholder:text-white/5 tracking-tight uppercase"
                    maxLength={200}
                  />
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 md:gap-0 mt-6 pt-6 border-t border-white/5">
                    <div className="flex items-center gap-6 w-full md:w-auto justify-between md:justify-start">
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-widest text-white/20 font-bold mb-1">UNIDADES</span>
                        <input
                          type="number"
                          min="1"
                          placeholder="OPCIONAL"
                          value={itemCount}
                          onChange={(e) => setItemCount(e.target.value === '' ? '' : Number(e.target.value))}
                          className="bg-black/20 border border-white/10 rounded-lg w-24 px-3 py-2 text-white font-bold text-center focus:outline-none focus:border-white/30 placeholder:text-[10px] placeholder:font-black placeholder:tracking-widest"
                        />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-widest text-white/20 font-bold mb-1">CARACTERES</span>
                        <div className="w-32 h-1 bg-white/5 rounded-full overflow-hidden mt-3">
                          <motion.div 
                            className="h-full bg-white"
                            initial={{ width: 0 }}
                            animate={{ width: `${(inputText.length / 200) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <button 
                      disabled={!inputText.trim() || isSending}
                      type="submit"
                      className="w-full md:w-auto justify-center bg-white text-black px-8 py-4 rounded-2xl disabled:opacity-10 disabled:cursor-not-allowed hover:bg-neutral-200 transition-all font-black flex items-center gap-3 group shadow-[0_0_20px_rgba(255,255,255,0.1)] active:scale-95"
                    >
                      {isSending ? 'TRANSMITINDO...' : 'TRANSMITIR'}
                      <Send size={18} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                    </button>
                  </div>
                </div>
              </form>

              <section className="relative z-10">
                <div className="flex items-center gap-4 mb-8">
                  <div className="h-[1px] flex-1 bg-white/5" />
                  <h3 className="text-[10px] font-black uppercase tracking-[0.5em] text-white/20">Registros Ativos</h3>
                  <div className="h-[1px] flex-1 bg-white/5" />
                </div>
                
                <div className="grid gap-4">
                  {messages.length === 0 && (
                    <div className="text-center py-10 opacity-20 border border-dashed border-white/10 rounded-3xl">
                      <p className="text-xs uppercase tracking-widest font-bold">Sem transmissões pendentes</p>
                    </div>
                  )}
                  <AnimatePresence initial={false}>
                    {messages.map((msg) => (
                      <motion.div 
                        key={msg.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white/5 p-6 rounded-3xl border border-white/5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-6 md:gap-4 group hover:bg-white/[0.08] transition-all"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-2">
                            <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest group-hover:text-white transition-colors truncate">{msg.senderName}</span>
                            <div className="w-1 h-1 rounded-full bg-white/20 shrink-0" />
                            <span className="text-[10px] font-bold text-[#7AC143] uppercase tracking-widest shrink-0">{msg.station}</span>
                            <div className="w-1 h-1 rounded-full bg-white/20 shrink-0" />
                            <span className="text-[10px] font-mono text-white/20 shrink-0">
                              {msg.createdAt?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-4 mt-1">
                            {msg.itemCount && (
                              <span className="bg-white/10 text-white px-3 py-1.5 rounded-xl text-xs font-black border border-white/20 whitespace-nowrap uppercase tracking-widest shrink-0">
                                {msg.itemCount} UNIDADES
                              </span>
                            )}
                            <p className="text-white text-xl font-bold tracking-tight uppercase leading-snug break-words">{msg.text}</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => deactivateMessage(msg.id)}
                          className="flex flex-row md:flex-col items-center justify-center gap-2 px-6 py-4 bg-white/5 hover:bg-[#7AC143] text-white/40 hover:text-white rounded-2xl transition-all border border-white/10 hover:border-[#7AC143] group/btn md:ml-4 flex-shrink-0 w-full md:w-auto"
                          title="Acusar recebimento"
                        >
                          <Check size={28} className="group-hover/btn:scale-110 transition-transform" />
                          <span className="text-[10px] font-black uppercase tracking-widest leading-none">CIENTE</span>
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            </div>
            
            <footer className="mt-12 text-center">
              <p className="text-[10px] uppercase tracking-[0.2em] text-black/30 font-bold italic">© 2026 FARMA.TV Sistema de Controle — Módulo de Alta Frequência</p>
            </footer>
          </motion.main>
        ) : mode === 'history' ? (
          <motion.main 
            key="history"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-4xl mx-auto pt-10 md:pt-32 pb-32 md:pb-20 px-4 md:px-6 w-full"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-8 md:mb-12">
              <div className="bg-[#7A1E6C] rounded-3xl p-6 border border-white/5">
                <div className="flex items-center gap-3 text-white/40 mb-4 font-bold text-[10px] uppercase tracking-widest">
                  <BarChart3 size={14} /> Total de Avisos
                </div>
                <div className="text-4xl font-black text-white italic tracking-tighter">{historyMessages.length}</div>
              </div>
              <div className="bg-[#7A1E6C] rounded-3xl p-6 border border-white/5">
                <div className="flex items-center gap-3 text-white/40 mb-4 font-bold text-[10px] uppercase tracking-widest">
                  <Clock size={14} /> Tempo Médio de Resposta
                </div>
                <div className="text-4xl font-black text-white italic tracking-tighter">
                  {averageResponseTime().toFixed(1)} <span className="text-sm not-italic opacity-40 font-bold tracking-widest uppercase">MIN</span>
                </div>
              </div>
              <div className="bg-[#7A1E6C] rounded-3xl p-6 border border-white/5">
                <div className="flex items-center gap-3 text-white/40 mb-4 font-bold text-[10px] uppercase tracking-widest">
                  <UserIcon size={14} /> Membros Ativos
                </div>
                <div className="text-4xl font-black text-white italic tracking-tighter">04</div>
              </div>
            </div>

            <div className="bg-[#7A1E6C] rounded-[2rem] md:rounded-[40px] p-5 md:p-8 border border-white/5 overflow-hidden">
              <h3 className="text-[10px] font-black uppercase tracking-[0.5em] text-white/20 mb-8">Log Histórico de Transmissões</h3>
              
              <div className="space-y-4">
                {historyMessages.map((msg) => {
                  const duration = msg.resolvedAt && msg.createdAt 
                    ? Math.round((msg.resolvedAt.toMillis() - msg.createdAt.toMillis()) / 1000 / 60)
                    : null;

                  return (
                    <div key={msg.id} className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 p-5 bg-white/[0.03] rounded-2xl border border-white/[0.05] hover:bg-white/[0.05] transition-all group">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3 mb-2">
                          <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest truncate">{msg.senderName}</span>
                          <span className="text-[10px] font-bold text-[#6DBE45] uppercase tracking-widest shrink-0">{msg.station}</span>
                          <span className="text-white/10 font-mono text-[10px] shrink-0"># {msg.id.substring(0, 8)}</span>
                        </div>
                        <div className="flex items-start md:items-center gap-4 flex-col md:flex-row">
                          {msg.itemCount && (
                            <span className="bg-white/10 text-white/70 px-2 py-0.5 rounded text-xs font-bold border border-white/10 whitespace-nowrap shrink-0">
                              {msg.itemCount} UN
                            </span>
                          )}
                          <p className="text-white font-bold uppercase tracking-tight break-words">{msg.text}</p>
                        </div>
                      </div>
                      <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center pt-2 md:pt-0 border-t border-white/5 md:border-t-0 mt-2 md:mt-0">
                        <div className="text-[10px] font-black italic text-[#7AC143] uppercase tracking-widest mb-1 md:mb-1">
                          {duration !== null ? `${duration}m RESOLVIDO` : 'CONCLUÍDO'}
                        </div>
                        <div className="text-[9px] font-mono text-white/20">
                          {msg.createdAt?.toDate().toLocaleDateString()} {msg.createdAt?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.main>
        ) : (
          <motion.main 
            key="tv"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`h-screen w-full flex flex-col items-center justify-center p-20 text-center relative pointer-events-none transition-colors duration-1000 ${
              tvStatus === 'critical' ? 'bg-red-50' : tvStatus === 'warning' ? 'bg-yellow-50' : 'bg-transparent'
            }`}
          >
            {/* Cinematic Background Atmosphere */}
            <div className={`fixed inset-0 overflow-hidden select-none transition-all duration-1000 ${tvStatus === 'critical' ? 'opacity-30' : tvStatus === 'warning' ? 'opacity-20' : 'opacity-10'}`}>
              <motion.div 
                animate={{ 
                  scale: [1, 1.4, 1],
                  opacity: tvStatus === 'critical' ? [0.4, 0.8, 0.4] : tvStatus === 'warning' ? [0.3, 0.6, 0.3] : [0.2, 0.4, 0.2],
                  x: [-100, 100, -100],
                  y: [-50, 50, -50]
                }}
                transition={{ duration: tvStatus === 'critical' ? 5 : tvStatus === 'warning' ? 10 : 25, repeat: Infinity, ease: "linear" }}
                className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150vw] h-[150vw] rounded-full blur-[200px] bg-gradient-to-tr ${
                  tvStatus === 'critical' ? 'from-red-600 via-rose-500 to-transparent' : 
                  tvStatus === 'warning' ? 'from-yellow-400 via-orange-300 to-transparent' : 
                  'from-[#7AC143] via-[#7A1E6C] to-transparent'
                }`}
              />
            </div>

            <AnimatePresence mode="wait">
              {messages.length > 0 ? (
                (() => {
                  const currentTvMessage = messages[tvMessageIndex] || messages[0];
                  return (
                    <motion.div 
                      key={currentTvMessage.id}
                      className="z-10 w-full"
                    >
                      <motion.div 
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="flex justify-center items-center gap-6 mb-12"
                      >
                        <div className="h-[2px] w-20 bg-black/20" />
                        <span className="text-[#7A1E6C] text-lg tracking-[0.8em] font-black uppercase opacity-80">
                          AVISO RECEBIDO: {currentTvMessage.station}
                          {messages.length > 1 && ` (${tvMessageIndex + 1}/${messages.length})`}
                        </span>
                        <div className="h-[2px] w-20 bg-black/20" />
                      </motion.div>

                      <div className="relative inline-block mt-8 mb-8">
                        {currentTvMessage.itemCount && (
                          <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4 }}
                            className="mb-8"
                          >
                            <span className="inline-block bg-[#7AC143]/20 border border-[#7AC143]/50 text-[#7AC143] px-8 py-4 rounded-3xl text-5xl font-black uppercase tracking-widest shadow-lg">
                              {currentTvMessage.itemCount} UNIDADES
                            </span>
                          </motion.div>
                        )}
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ 
                            opacity: 1, 
                            scale: 1, 
                            color: tvStatus === 'critical' ? '#dc2626' : tvStatus === 'warning' ? '#d97706' : '#7A1E6C'
                          }}
                          transition={{ 
                            type: "spring", 
                            stiffness: 150, 
                            damping: 15,
                            delay: 0.3
                          }}
                          className="text-[12vw] font-black leading-[0.85] tracking-tighter uppercase italic select-none drop-shadow-md line-clamp-3"
                        >
                          {currentTvMessage.text}
                        </motion.div>
                        <motion.div 
                          animate={{ opacity: [0, 1, 0] }}
                          transition={{ duration: tvStatus === 'critical' ? 0.3 : tvStatus === 'warning' ? 0.5 : 0.1, repeat: Infinity, repeatDelay: tvStatus === 'normal' ? 5 : 0 }}
                          className={`absolute inset-0 blur-3xl -z-10 ${
                            tvStatus === 'critical' ? 'bg-red-500/20' : 
                            tvStatus === 'warning' ? 'bg-yellow-500/20' : 
                            'bg-[#7A1E6C]/10'
                          }`}
                        />
                      </div>

                      <motion.div 
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.7 }}
                        className="flex items-center justify-center gap-12 mt-20 bg-white/80 p-10 rounded-[40px] border border-black/5 shadow-xl backdrop-blur-md"
                      >
                        <div className="flex flex-col items-center">
                          <span className="text-[10px] font-black uppercase tracking-[0.5em] text-black/40 mb-2">DE: ORIGEM</span>
                          <span className="text-4xl font-bold text-[#7A1E6C] tracking-widest uppercase">{currentTvMessage.senderName}</span>
                        </div>
                        <div className="w-[2px] h-16 bg-black/10" />
                        <TvElapsedTime 
                          createdAt={currentTvMessage.createdAt} 
                          onStatusChange={setTvStatus}
                        />
                        <div className="w-[2px] h-16 bg-black/10" />
                        <div className="flex flex-col items-center">
                          <span className="text-[10px] font-black uppercase tracking-[0.5em] text-black/40 mb-2">HORA: REGISTRO</span>
                          <span className="text-4xl font-mono font-bold text-[#7AC143] tracking-tighter">
                            {currentTvMessage.createdAt?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </motion.div>
                    </motion.div>
                  );
                })()
              ) : (
                <motion.div 
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-8 opacity-20"
                >
                  <div className="relative">
                    <Tv size={120} className="text-black" />
                    <motion.div 
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <div className="w-full h-[1px] bg-black/50" />
                    </motion.div>
                  </div>
                  <h2 className="text-[#7A1E6C] text-3xl font-black tracking-[0.8em] uppercase italic ml-[0.8em]">ESCANEANDO SISTEMA...</h2>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="fixed bottom-12 left-12 right-12 flex justify-between items-end pointer-events-auto">
              <div className="flex flex-col items-start gap-1">
                <div className="flex gap-2 mb-2">
                  {['ALL', ...stations].map(s => (
                    <button
                      key={s}
                      onClick={() => {
                        setTvStation(s);
                        localStorage.setItem('farma_tv_station', s);
                      }}
                      className={`px-3 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all border ${tvStation === s ? 'bg-[#7A1E6C] text-white border-[#7A1E6C]' : 'bg-transparent text-black/40 border-black/10 hover:text-black hover:border-black/30'}`}
                    >
                      {s === 'ALL' ? 'TODOS' : s}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] font-black text-black/20 uppercase tracking-[0.4em]">Link de Nó: Estabilizado | TV: {tvStation === 'ALL' ? 'GLOBAL' : tvStation.toUpperCase()}</span>
                <span className="text-[8px] font-mono text-black/10">{user.uid.substring(0, 16)}@FARMA.TV-CH-01</span>
              </div>
              <div className="flex items-center gap-4">
                <motion.div 
                  animate={{ height: [4, 12, 6, 16, 4] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="w-1 bg-[#7AC143]/40"
                />
                <motion.div 
                  animate={{ height: [8, 4, 16, 8, 12] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                  className="w-1 bg-[#7AC143]/40"
                />
                <motion.div 
                  animate={{ height: [12, 16, 4, 12, 8] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                  className="w-1 bg-[#7AC143]/40"
                />
              </div>
            </div>
          </motion.main>
        )}
      </AnimatePresence>
    </div>
  );
}

