/** 骨架屏：用于数据加载中的占位。 */
export interface SkeletonProps {
  /** 行数，默认 3 */
  lines?: number;
  /** 每行高度，默认 14 */
  lineHeight?: number;
  /** 容器样式 */
  style?: React.CSSProperties;
  /** 是否显示圆形头像位 */
  avatar?: boolean;
}

export function Skeleton({ lines = 3, lineHeight = 14, style, avatar = false }: SkeletonProps) {
  return (
    <div className="skeleton" style={style}>
      {avatar && <div className="skeleton-avatar" />}
      <div className="skeleton-lines">
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className="skeleton-line"
            style={{
              height: lineHeight,
              width: index === lines - 1 ? "60%" : "100%",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** 骨架屏卡片：模拟 panel 结构。 */
export function SkeletonCard({ lines = 4 }: { lines?: number }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div className="skeleton-line" style={{ height: 16, width: 120 }} />
      </div>
      <div className="panel-body">
        <Skeleton lines={lines} />
      </div>
    </section>
  );
}

export default Skeleton;
