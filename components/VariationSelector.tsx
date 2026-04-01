'use client';

import { useState } from 'react';
import { VariationStrategy, getAllStrategies, getStrategyDescription } from '@/app/lib/variationStrategies';

interface VariationSelectorProps {
  onGenerate: (strategy: VariationStrategy, offset?: number) => void;
  isGenerating: boolean;
}

export default function VariationSelector({ onGenerate, isGenerating }: VariationSelectorProps) {
  const [selectedStrategy, setSelectedStrategy] = useState<VariationStrategy>(VariationStrategy.ROTATION_OFFSET);
  const [offset, setOffset] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const strategies = getAllStrategies();

  return (
    <div className="card p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <span>🎯</span>
            <span>توليد جدول جديد</span>
          </h3>
          <p className="text-sm text-slate-600 mt-1">
            اختر استراتيجية التنويع لإنشاء جدول مختلف
          </p>
        </div>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-sm text-brand-600 hover:text-brand-700 font-medium transition-colors"
        >
          {showAdvanced ? 'إخفاء الخيارات' : 'خيارات متقدمة'}
        </button>
      </div>

      {/* Strategy Selection */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">
          استراتيجية التنويع
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {strategies.map((strategy) => (
            <button
              key={strategy}
              onClick={() => setSelectedStrategy(strategy)}
              className={`
                p-4 rounded-lg border-2 transition-all text-right
                ${selectedStrategy === strategy
                  ? 'border-brand-600 bg-brand-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-brand-300'
                }
              `}
            >
              <div className="flex items-start gap-3">
                <div className="text-2xl">
                  {strategy === VariationStrategy.ROTATION_OFFSET && '🔄'}
                  {strategy === VariationStrategy.GROUP_SWAP && '🔀'}
                  {strategy === VariationStrategy.INVERSION && '⇄'}
                </div>
                <div className="flex-1">
                  <div className={`font-semibold text-sm ${
                    selectedStrategy === strategy ? 'text-brand-700' : 'text-slate-800'
                  }`}>
                    {getStrategyDescription(strategy)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {getStrategyExplanation(strategy)}
                  </div>
                </div>
                {selectedStrategy === strategy && (
                  <div className="text-brand-600">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Advanced Options */}
      {showAdvanced && (
        <div className="pt-4 border-t border-slate-200 space-y-3">
          <label className="block text-sm font-medium text-slate-700">
            معامل التنويع (Offset)
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="1"
              max="5"
              value={offset}
              onChange={(e) => setOffset(Number(e.target.value))}
              className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--brand-600) 0%, var(--brand-600) ${(offset - 1) * 25}%, #e2e8f0 ${(offset - 1) * 25}%, #e2e8f0 100%)`
              }}
            />
            <span className="text-lg font-bold text-brand-600 w-12 text-center">
              {offset}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            معامل أكبر = تغيير أكبر في الجدول
          </p>
        </div>
      )}

      {/* Generate Button */}
      <button
        onClick={() => onGenerate(selectedStrategy, offset)}
        disabled={isGenerating}
        className="w-full btn btn-primary h-12 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isGenerating ? (
          <>
            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>جاري التوليد...</span>
          </>
        ) : (
          <>
            <span>✨</span>
            <span>توليد جدول جديد</span>
          </>
        )}
      </button>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex gap-3">
          <div className="text-blue-600 text-xl">ℹ️</div>
          <div className="flex-1">
            <p className="text-sm text-blue-800 font-medium">
              نظام التنويع الذكي
            </p>
            <p className="text-xs text-blue-700 mt-1">
              كل استراتيجية تُنتج جدول مختلف تماماً مع الحفاظ على جميع القيود:
              التغطية اليومية، الشفتات الثابتة، والإجازات المعتمدة.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function getStrategyExplanation(strategy: VariationStrategy): string {
  const explanations = {
    [VariationStrategy.ROTATION_OFFSET]: 'تغيير نقطة البداية في دورة الموظفين',
    [VariationStrategy.GROUP_SWAP]: 'تبديل مجموعات الموظفين مع بعضهم',
    [VariationStrategy.INVERSION]: 'عكس جميع الشفتات (صباح ↔ مساء)'
  };
  
  return explanations[strategy] || '';
}
