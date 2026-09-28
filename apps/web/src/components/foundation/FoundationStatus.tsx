import type { EffectiveResourcePolicy, HostProfile, JobModel } from "@taste-inbox/shared";

interface Props {
  readonly dataSource: "mock" | "live";
  readonly hostProfile: HostProfile;
  readonly resourcePolicy: EffectiveResourcePolicy;
  readonly itemCount: number;
  readonly jobs: readonly JobModel[];
}

/** Two decimals at most, with trailing zeros dropped: 16 → "16GB", 10.8 → "10.8GB". */
const GB = (value: number): string => `${String(Number(value.toFixed(2)))}GB`;

const PRESSURE_LABEL: Record<HostProfile["memoryPressure"], string> = {
  normal: "정상",
  warning: "주의",
  critical: "위험",
  unknown: "확인 불가",
};

/**
 * Phase 0 status summary.
 *
 * Two rules from the design docs are already in force here, because they are cheap to
 * honour now and expensive to retrofit:
 *
 * - Status is never colour-only (DESIGN.md §18) — every state carries a text label.
 * - A derived limit is shown with what it was derived from (DESIGN.md §3.5), so an
 *   operator-tightened value is never mistaken for a hardware ceiling.
 */
export function FoundationStatus({
  dataSource,
  hostProfile,
  resourcePolicy,
  itemCount,
  jobs,
}: Props) {
  const blocked = jobs.filter((job) => job.state === "blocked");

  return (
    <section className="system-section" aria-labelledby="status-heading">
      <h2 id="status-heading" className="type-section-title">
        연결 상태
      </h2>

      <dl className="system-grid">
        <div className="system-card">
          <dt className="type-label">데이터 소스</dt>
          <dd className="type-card-title">{dataSource === "mock" ? "Mock" : "Live"}</dd>
          <p className="type-body-small">
            {dataSource === "mock"
              ? "저장소에 들어 있는 예시 데이터를 보여줘요. 이 Mac의 서비스에 연결하지 않았어요."
              : "이 Mac에서 도는 서비스의 데이터를 보여줘요."}
          </p>
        </div>

        <div className="system-card">
          <dt className="type-label">호스트 프로파일</dt>
          <dd className="type-card-title type-numeric">
            {GB(hostProfile.unifiedMemoryGb)} · {GB(hostProfile.totalStorageGb)}
          </dd>
          <p className="type-body-small">
            메모리 압력 {PRESSURE_LABEL[hostProfile.memoryPressure]} ·{" "}
            <span className="type-mono">{hostProfile.architecture}</span>
          </p>
        </div>

        <div className="system-card">
          <dt className="type-label">자동 준비 한도</dt>
          <dd className="type-card-title type-numeric">
            {GB(resourcePolicy.memory.autoPrepareLimitGb)}
          </dd>
          <p className="type-body-small">
            가용 메모리 {GB(resourcePolicy.memory.usableMemoryGb)}에서 계산 · 수동 검토 한도{" "}
            {GB(resourcePolicy.memory.manualReviewLimitGb)}
          </p>
        </div>

        <div className="system-card">
          <dt className="type-label">캐시 예산</dt>
          <dd className="type-card-title type-numeric">
            {GB(resourcePolicy.storage.cacheBudgetGb)}
          </dd>
          <p className="type-body-small">
            모델 {GB(resourcePolicy.storage.cacheShares.modelGb)} · 컨테이너{" "}
            {GB(resourcePolicy.storage.cacheShares.containerGb)} · 미디어{" "}
            {GB(resourcePolicy.storage.cacheShares.mediaGb)}
          </p>
        </div>

        <div className="system-card">
          <dt className="type-label">동시 실행</dt>
          <dd className="type-card-title type-numeric">
            빌드 {resourcePolicy.concurrency.environmentBuilds}
          </dd>
          <p className="type-body-small">
            로컬 모델 동시 실행{" "}
            {resourcePolicy.concurrency.allowLocalModelWhileBuilding ? "허용" : "대기"}
          </p>
        </div>

        <div className="system-card">
          <dt className="type-label">Inbox 항목</dt>
          <dd className="type-card-title type-numeric">{itemCount}</dd>
          <p className="type-body-small">
            작업 {jobs.length}건
            {blocked.length > 0 ? ` · 확인 필요 ${String(blocked.length)}건` : ""}
          </p>
        </div>
      </dl>

      {resourcePolicy.gates.reason !== null ? (
        <p className="system-note type-body-small" role="note">
          <strong>참고</strong> — {resourcePolicy.gates.reason}
        </p>
      ) : null}

      {resourcePolicy.appliedTightenings.length > 0 ? (
        <p className="system-note type-body-small">
          <strong>운영자 제한 적용됨</strong> —{" "}
          <span className="type-mono">{resourcePolicy.appliedTightenings.join(", ")}</span>
        </p>
      ) : null}
    </section>
  );
}
