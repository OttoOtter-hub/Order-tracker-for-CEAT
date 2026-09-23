import { useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { KeyRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { MIN_PASSWORD_LENGTH, useChangePasswordMutation } from "@/api/users"
import { getErrorMessage } from "@/lib/errors"

interface ChangePasswordValues {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

const EMPTY: ChangePasswordValues = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
}

// Both roles, from the sidebar next to the user's email: the user's own
// password only (the API has no user id to pass). The session stays as it is.
export function ChangePasswordDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const changePassword = useChangePasswordMutation()
  const form = useForm<ChangePasswordValues>({ defaultValues: EMPTY })

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      form.reset(EMPTY)
    }
  }

  function onSubmit(values: ChangePasswordValues) {
    changePassword.mutate(
      {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      },
      {
        onSuccess: () => {
          toast.success(t("changePassword.changed"))
          handleOpenChange(false)
        },
        onError: (error) =>
          toast.error(getErrorMessage(error, t("changePassword.failed"))),
      }
    )
  }

  const minRule = {
    value: MIN_PASSWORD_LENGTH,
    message: t("changePassword.tooShort", { min: MIN_PASSWORD_LENGTH }),
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="link"
          size="sm"
          className="h-auto gap-1 p-0 text-xs text-muted-foreground"
        >
          <KeyRound className="size-3" />
          {t("nav.changePassword")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("changePassword.title")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="currentPassword"
              rules={{ required: t("changePassword.currentRequired") }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("changePassword.current")}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPassword"
              rules={{ required: minRule.message, minLength: minRule }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("changePassword.new")}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              rules={{
                validate: (value, values) =>
                  value === values.newPassword || t("changePassword.mismatch"),
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("changePassword.confirm")}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={changePassword.isPending}>
              {changePassword.isPending
                ? t("changePassword.submitting")
                : t("changePassword.submit")}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
