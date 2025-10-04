import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const ChatSkeleton = () => {
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4">
      <Card className="w-full max-w-5xl h-[calc(100vh-2rem)] flex flex-col overflow-hidden shadow-elegant">
        {/* Messages area skeleton */}
        <div className="flex-1 overflow-hidden p-4 space-y-4">
          <div className="flex justify-end">
            <Skeleton className="h-16 w-3/4 rounded-2xl" />
          </div>
          <div className="flex justify-start">
            <Skeleton className="h-32 w-4/5 rounded-2xl" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-12 w-2/3 rounded-2xl" />
          </div>
          <div className="flex justify-start">
            <Skeleton className="h-40 w-4/5 rounded-2xl" />
          </div>
        </div>

        {/* Input area skeleton */}
        <div className="p-4 border-t">
          <div className="flex gap-2">
            <Skeleton className="flex-1 h-10" />
            <Skeleton className="h-10 w-10" />
            <Skeleton className="h-10 w-10" />
          </div>
        </div>
      </Card>
    </div>
  );
};

export default ChatSkeleton;
