import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { RELATIONS } from '@/lib/relations'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (relation: string, note: string) => void
}

export default function RelationDialog({ open, onOpenChange, onConfirm }: Props) {
  const [relation, setRelation] = useState<string>(RELATIONS[0])
  const [note, setNote] = useState('')

  useEffect(() => {
    if (open) {
      setRelation(RELATIONS[0])
      setNote('')
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>建立关系</DialogTitle>
          <DialogDescription>为这条连线选择关系类型，并可附上一行备注。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>关系类型</Label>
            <Select value={relation} onValueChange={setRelation}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>备注（可选）</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：第三章数据来源"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onConfirm(relation, note.trim())
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => onConfirm(relation, note.trim())}>创建连线</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
