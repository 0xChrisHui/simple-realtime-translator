"use client";

import { memo } from "react";
import { DEPLOY_YOUR_OWN_URL, SONIOX_SIGNUP_URL } from "../lib/constants";

export type TrialNoticeVariant = "ended" | "exhausted";

type TrialEndedCardProps = {
  variant: TrialNoticeVariant;
  onClose: () => void;
};

export const TrialEndedCard = memo(function TrialEndedCard({ variant, onClose }: TrialEndedCardProps) {
  return (
    <div className="save-panel-backdrop" role="presentation">
      <section aria-label="Trial ended" aria-modal="true" className="trial-card" role="dialog">
        <button aria-label="Close" className="tiny-button trial-card-close" onClick={onClose} type="button">
          ×
        </button>

        <h2 className="trial-card-title">
          {variant === "ended" ? "试用结束 / Trial ended" : "今日试用次数已用完 / Daily free trials used up"}
        </h2>
        <p className="trial-card-subtitle">喜欢的话，两种方式继续使用 / Two ways to keep using it:</p>

        <div className="trial-card-actions">
          <a className="trial-card-button trial-card-button-primary" href={SONIOX_SIGNUP_URL} rel="noreferrer" target="_blank">
            Get a free Soniox key
            <span>注册即送免费额度 / Sign-up includes free credits</span>
          </a>
          <a className="trial-card-button" href={DEPLOY_YOUR_OWN_URL} rel="noreferrer" target="_blank">
            Deploy your own
            <span>部署你自己的实例 / Run your own instance</span>
          </a>
        </div>

        <p className="trial-card-note">
          {variant === "ended"
            ? "本次 3 分钟的字幕已保存，可在 Save 面板下载。 / This 3-minute transcript is saved in the Save panel."
            : "每天每位访客有 2 次免费试用，明天可再来。 / Each visitor gets 2 free trials per day."}
        </p>
      </section>
    </div>
  );
});
