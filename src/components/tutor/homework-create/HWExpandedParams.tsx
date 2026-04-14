import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { MetaState } from './types';

export interface HWExpandedParamsProps {
  meta: MetaState;
  onChange: (m: MetaState) => void;
}

/**
 * L1 (collapsible) advanced toggles. After 2026-04-14 layout reshuffle, only
 * AI-bootstrap toggle lives here — Title, Subject, Deadline moved to L0.
 * Materials block is rendered as a sibling section by the container.
 */
export function HWExpandedParams({ meta, onChange }: HWExpandedParamsProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
        <div>
          <Label htmlFor="ai-bootstrap" className="text-sm font-medium">
            AI-вступление к задачам
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            AI пишет стартовое сообщение при открытии каждой задачи
          </p>
        </div>
        <Switch
          id="ai-bootstrap"
          checked={!(meta.disable_ai_bootstrap ?? false)}
          onCheckedChange={(checked) =>
            onChange({ ...meta, disable_ai_bootstrap: !checked })
          }
        />
      </div>
    </div>
  );
}
