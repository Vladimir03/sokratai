import { Card } from "@/components/ui/card";

const ChatSkeleton = () => {
  return (
    <div className="space-y-4 animate-pulse">
      {/* User message skeleton */}
      <div className="flex justify-end">
        <div className="bg-muted/50 p-4 rounded-2xl max-w-[80%] skeleton" style={{ height: "60px", width: "70%" }} />
      </div>
      
      {/* Assistant message skeleton */}
      <div className="flex justify-start">
        <div className="bg-muted/30 p-4 rounded-2xl max-w-[85%] space-y-2 skeleton" style={{ width: "80%" }}>
          <div className="h-4 bg-muted/50 rounded w-full" />
          <div className="h-4 bg-muted/50 rounded w-11/12" />
          <div className="h-4 bg-muted/50 rounded w-4/5" />
        </div>
      </div>
      
      {/* User message skeleton */}
      <div className="flex justify-end">
        <div className="bg-muted/50 p-4 rounded-2xl skeleton" style={{ height: "48px", width: "60%" }} />
      </div>
      
      {/* Assistant message skeleton */}
      <div className="flex justify-start">
        <div className="bg-muted/30 p-4 rounded-2xl max-w-[85%] space-y-2 skeleton" style={{ width: "75%" }}>
          <div className="h-4 bg-muted/50 rounded w-full" />
          <div className="h-4 bg-muted/50 rounded w-10/12" />
          <div className="h-4 bg-muted/50 rounded w-9/12" />
          <div className="h-4 bg-muted/50 rounded w-11/12" />
        </div>
      </div>
    </div>
  );
};

export default ChatSkeleton;
