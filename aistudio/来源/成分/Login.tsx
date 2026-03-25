import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../contexts/LanguageContext';
import { Terminal, Lock, User } from 'lucide-react';
import { motion } from 'motion/react';

export const Login = () => {
  const { login } = useAuth();
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    const success = await login(username, password);
    if (!success) {
      setError('Invalid credentials. Use admin/admin123');
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#080B10] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-[#151921] border border-slate-800 rounded-2xl p-8 shadow-2xl"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-sky-500 rounded-2xl flex items-center justify-center shadow-lg shadow-sky-500/20 mb-4">
            <Terminal className="text-white" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-white">OpenClaw</h1>
          <p className="text-slate-500 text-sm mt-1">{t('common.levelAccess')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('common.username')}</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-[#0B1015] border border-slate-700 rounded-xl pl-12 pr-4 py-3 text-slate-200 outline-none focus:ring-2 focus:ring-sky-500/50 transition-all"
                placeholder="admin"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('common.password')}</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#0B1015] border border-slate-700 rounded-xl pl-12 pr-4 py-3 text-slate-200 outline-none focus:ring-2 focus:ring-sky-500/50 transition-all"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          {error && <p className="text-rose-400 text-xs font-medium text-center">{error}</p>}

          <button 
            type="submit"
            disabled={isLoading}
            className="w-full bg-sky-500 hover:bg-sky-600 text-white py-3 rounded-xl font-bold transition-all shadow-lg shadow-sky-500/20 active:scale-[0.98] disabled:opacity-50"
          >
            {isLoading ? '...' : t('common.login')}
          </button>
        </form>

        <p className="mt-8 text-center text-slate-600 text-xs">
          OpenClaw Command Center v2.0
        </p>
      </motion.div>
    </div>
  );
};
