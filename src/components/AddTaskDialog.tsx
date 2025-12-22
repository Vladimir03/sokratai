import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface AddTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homeworkSetId: string;
}

const AddTaskDialog = ({ open, onOpenChange, homeworkSetId }: AddTaskDialogProps) => {
  const [taskNumber, setTaskNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const queryClient = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!taskNumber.trim()) {
      toast.error("Введите номер задачи");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase
        .from("homework_tasks")
        .insert({
          homework_set_id: homeworkSetId,
          task_number: taskNumber.trim(),
          status: "not_started",
        });

      if (error) throw error;

      toast.success("Задача добавлена");
      queryClient.invalidateQueries({ queryKey: ["homework-tasks", homeworkSetId] });
      setTaskNumber("");
      onOpenChange(false);
    } catch (error) {
      console.error("Error adding task:", error);
      toast.error("Ошибка при добавлении задачи");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Добавить задачу</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="taskNumber">Номер задачи</Label>
            <Input
              id="taskNumber"
              placeholder="Например: 5, 6a, 7.1"
              value={taskNumber}
              onChange={(e) => setTaskNumber(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Добавление..." : "Добавить"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddTaskDialog;
