import { useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { UserPlus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { useAuth } from "@/auth/AuthContext"
import type { Role } from "@/auth/storage"
import { useCustomersQuery } from "@/api/customers"
import {
  MIN_PASSWORD_LENGTH,
  useCreateUserMutation,
  useSetUserActiveMutation,
  useUsersQuery,
  type ManagedUser,
} from "@/api/users"
import { formatDateTime } from "@/lib/format"
import { getErrorMessage } from "@/lib/errors"

// Phase 20a: ops manage logins — several employees per role. Users are only
// ever deactivated, never deleted (they stay the author of what they did).
export function UsersPage() {
  const { t } = useTranslation()
  const { user: me } = useAuth()
  const users = useUsersQuery()
  const setActive = useSetUserActiveMutation()
  const [toDeactivate, setToDeactivate] = useState<ManagedUser | null>(null)

  function changeStatus(user: ManagedUser, active: boolean) {
    setActive.mutate(
      { id: user.id, active },
      {
        onSuccess: () => {
          toast.success(
            t(active ? "users.reactivated" : "users.deactivated", {
              email: user.email,
            })
          )
          setToDeactivate(null)
        },
        onError: (error) =>
          toast.error(getErrorMessage(error, t("users.actionFailed"))),
      }
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("users.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("users.description")}</p>
        </div>
        <AddUserDialog />
      </div>

      {users.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : users.isError ? (
        <p className="text-sm text-destructive">
          {getErrorMessage(users.error, t("users.loadFailed"))}
        </p>
      ) : !users.data?.length ? (
        <p className="text-sm text-muted-foreground">{t("users.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("users.columns.email")}</TableHead>
              <TableHead>{t("users.columns.role")}</TableHead>
              <TableHead>{t("users.columns.customer")}</TableHead>
              <TableHead>{t("users.columns.status")}</TableHead>
              <TableHead>{t("users.columns.createdAt")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data.map((user) => {
              const isMe = user.id === me?.id
              return (
                <TableRow
                  key={user.id}
                  className={user.isActive ? undefined : "text-muted-foreground"}
                >
                  <TableCell className="font-medium">
                    {user.email}
                    {isMe && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({t("users.you")})
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{t(`users.roles.${user.role}`)}</TableCell>
                  <TableCell>{user.customer?.name ?? "—"}</TableCell>
                  <TableCell>
                    {user.isActive ? (
                      <Badge variant="secondary">{t("users.status.active")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("users.status.inactive")}</Badge>
                    )}
                  </TableCell>
                  <TableCell>{formatDateTime(user.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    {user.isActive ? (
                      // The API refuses self-deactivation too; the button just
                      // isn't offered.
                      !isMe && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setToDeactivate(user)}
                        >
                          {t("users.deactivate")}
                        </Button>
                      )
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={setActive.isPending}
                        onClick={() => changeStatus(user, true)}
                      >
                        {t("users.reactivate")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={toDeactivate !== null}
        onOpenChange={(open) => !open && setToDeactivate(null)}
        title={t("users.deactivateTitle", { email: toDeactivate?.email ?? "" })}
        description={t("users.deactivateDescription")}
        confirmLabel={t("users.deactivate")}
        destructive
        isPending={setActive.isPending}
        onConfirm={() => toDeactivate && changeStatus(toDeactivate, false)}
      />
    </div>
  )
}

interface NewUserValues {
  email: string
  password: string
  role: Role
  customerId: string
}

const EMPTY_USER: NewUserValues = {
  email: "",
  password: "",
  role: "client",
  customerId: "",
}

function AddUserDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const createUser = useCreateUserMutation()
  const { data: customers = [] } = useCustomersQuery()
  const form = useForm<NewUserValues>({ defaultValues: EMPTY_USER })
  const role = form.watch("role")

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      form.reset(EMPTY_USER)
    }
  }

  function onSubmit(values: NewUserValues) {
    createUser.mutate(
      {
        email: values.email,
        password: values.password,
        role: values.role,
        // A customer only means something for a client login.
        customerId: values.role === "client" ? values.customerId : undefined,
      },
      {
        onSuccess: (created) => {
          toast.success(t("users.form.created", { email: created.email }))
          handleOpenChange(false)
        },
        onError: (error) =>
          toast.error(getErrorMessage(error, t("users.form.failed"))),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1">
          <UserPlus className="size-4" />
          {t("users.add")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("users.form.title")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="email"
              rules={{ required: t("users.form.emailRequired") }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("users.form.email")}</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              rules={{
                minLength: {
                  value: MIN_PASSWORD_LENGTH,
                  message: t("users.form.passwordHint", { min: MIN_PASSWORD_LENGTH }),
                },
                required: t("users.form.passwordHint", { min: MIN_PASSWORD_LENGTH }),
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("users.form.password")}</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>
                    {t("users.form.passwordHint", { min: MIN_PASSWORD_LENGTH })}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("users.form.role")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="client">{t("users.roles.client")}</SelectItem>
                      <SelectItem value="ops">{t("users.roles.ops")}</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            {role === "client" && (
              <FormField
                control={form.control}
                name="customerId"
                rules={{ required: t("users.form.customerRequired") }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("users.form.customer")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("users.form.customerPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {customers.map((customer) => (
                          <SelectItem key={customer.id} value={customer.id}>
                            {customer.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <Button type="submit" disabled={createUser.isPending}>
              {createUser.isPending ? t("users.form.submitting") : t("users.form.submit")}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
