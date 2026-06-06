import React from 'react';
import { Button } from './ui/button';
import { HomeIcon } from '@radix-ui/react-icons';

export const Pig404: React.FC = () => {
  const handleReturnHome = () => {
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-pink-50 via-pink-100 to-pink-200 flex flex-col items-center justify-center p-4">
      {/* Background shapes */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-pink-300 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob"></div>
      <div className="absolute top-[20%] right-[-10%] w-80 h-80 bg-pink-400 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob animation-delay-2000"></div>
      <div className="absolute bottom-[-20%] left-[20%] w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob animation-delay-4000"></div>

      <div className="z-10 flex flex-col items-center text-center space-y-6 max-w-lg bg-white/60 p-8 rounded-3xl backdrop-blur-xl border-2 border-white/80 shadow-2xl">
        <div className="relative group">
          <div className="absolute inset-0 bg-pink-500/10 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10 blur-xl"></div>
          <img 
            src="/pig-404.png" 
            alt="Confused Pig 404 Error" 
            className="w-64 h-64 object-contain mx-auto drop-shadow-xl transform group-hover:scale-105 transition-transform duration-300"
          />
        </div>
        
        <div className="space-y-2">
          <h1 className="text-5xl font-black text-slate-900 tracking-tight">OINK! 404</h1>
          <h2 className="text-2xl font-bold text-pink-600">Page Not Found</h2>
          <p className="text-slate-600 font-medium pt-2">
            Oops! The page you're looking for seems to have been eaten by our hungry little pig.
          </p>
        </div>

        <Button 
          onClick={handleReturnHome}
          className="h-12 px-8 text-base font-bold text-white bg-gradient-to-r from-pink-500 to-pink-600 hover:from-pink-600 hover:to-pink-700 shadow-lg hover:shadow-pink-500/30 rounded-xl transition-all active:scale-[0.98] flex items-center gap-2 mt-4"
        >
          <HomeIcon className="w-5 h-5" />
          Return to Dashboard
        </Button>
      </div>
    </div>
  );
};
