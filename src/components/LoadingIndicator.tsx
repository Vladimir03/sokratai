import { useEffect, useState } from "react";

const LoadingIndicator = () => {
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const getMessage = () => {
    if (elapsedTime < 5) {
      return "Думаю над ответом...";
    } else if (elapsedTime < 15) {
      return "Анализирую задачу подробнее...";
    } else {
      return "Генерирую развернутый ответ...";
    }
  };

  return (
    <div className="flex justify-start mb-4">
      <div className="bg-secondary text-secondary-foreground rounded-lg p-4 max-w-[80%]">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <span className="w-2 h-2 bg-current rounded-full animate-bounce [animation-delay:-0.3s]"></span>
            <span className="w-2 h-2 bg-current rounded-full animate-bounce [animation-delay:-0.15s]"></span>
            <span className="w-2 h-2 bg-current rounded-full animate-bounce"></span>
          </div>
          <span className="text-sm">{getMessage()}</span>
        </div>
      </div>
    </div>
  );
};

export default LoadingIndicator;
