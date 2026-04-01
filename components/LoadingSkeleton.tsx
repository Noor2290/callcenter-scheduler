export default function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header Skeleton */}
      <div className="h-32 bg-gradient-to-r from-slate-200 to-slate-100 rounded-2xl"></div>
      
      {/* Stats Skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 bg-slate-200 rounded-xl"></div>
        ))}
      </div>
      
      {/* Action Bar Skeleton */}
      <div className="h-16 bg-slate-200 rounded-xl"></div>
      
      {/* Table Skeleton */}
      <div className="space-y-3">
        <div className="h-12 bg-slate-300 rounded-xl"></div>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="h-16 bg-slate-100 rounded-lg"></div>
        ))}
      </div>
    </div>
  );
}
