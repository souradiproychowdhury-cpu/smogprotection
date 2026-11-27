import React from 'react';
import type { ImpactMetricResult } from '@aetheria/shared';
import { ModalDialog } from './ModalDialog';

interface ImpactFormulaDialogProps {
  metric: { label: string; result: ImpactMetricResult } | null;
  onClose: () => void;
}

export const ImpactFormulaDialog: React.FC<ImpactFormulaDialogProps> = ({ metric, onClose }) => {
  return (
    <ModalDialog open={Boolean(metric)} onClose={onClose} title="How We Calculated This">
      {metric && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-xl bg-surface-container">
            <div>
              <div className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                {metric.label}
              </div>
              <div className="font-headline-md text-headline-md text-primary font-bold">
                {metric.result.value} {metric.result.unit}
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-primary/15 text-primary font-label-sm text-label-sm font-bold uppercase">
              Estimate
            </span>
          </div>

          <div className="space-y-1.5">
            <h2 className="font-label-md text-label-md uppercase tracking-wider text-secondary">
              Scientific Basis
            </h2>
            <p className="font-body-sm text-body-sm text-on-surface leading-relaxed">{metric.result.basis}</p>
          </div>

          <div className="space-y-1.5">
            <h2 className="font-label-md text-label-md uppercase tracking-wider text-tertiary">
              Transparent Formula
            </h2>
            <code className="block p-3 rounded-xl bg-surface-container-lowest text-tertiary font-mono text-xs overflow-x-auto">
              {metric.result.formula}
            </code>
          </div>

          <div className="space-y-2">
            <h2 className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
              Inputs Used
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(metric.result.inputs).map(([k, v]) => (
                <div key={k} className="p-2.5 rounded-lg bg-surface-container flex flex-col">
                  <span className="font-label-sm text-label-sm text-on-surface-variant">{k}</span>
                  <span className="font-label-md text-label-md text-on-surface font-semibold">
                    {String(v)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </ModalDialog>
  );
};
