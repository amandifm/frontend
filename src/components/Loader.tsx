'use client';

import React from 'react';

interface LoaderProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
  fullScreen?: boolean;
}

const Loader: React.FC<LoaderProps> = ({
  size = 'md',
  message = 'Loading...',
  fullScreen = false,
}) => {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
  };

  const spinnerContent = (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className={`${sizeClasses[size]} animate-spin`}>
        <div className="h-full w-full border-4 border-gray-200 border-t-blue-500 rounded-full"></div>
      </div>
      {message && <p className="text-gray-600 text-sm">{message}</p>}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black/20 z-50">
        <div className="bg-white p-8 rounded-lg shadow-lg">{spinnerContent}</div>
      </div>
    );
  }

  return <div className="flex items-center justify-center">{spinnerContent}</div>;
};

export default Loader;
