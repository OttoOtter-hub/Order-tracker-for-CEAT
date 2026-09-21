import { Navigate, Route, Routes } from "react-router-dom"
import { ProtectedRoute } from "@/auth/ProtectedRoute"
import { useAuth } from "@/auth/AuthContext"
import { LoginPage } from "@/pages/LoginPage"
import { OpsLayout } from "@/layouts/OpsLayout"
import { ClientLayout } from "@/layouts/ClientLayout"
import { PiListPage } from "@/pages/shared/PiListPage"
import { PiDetailPage } from "@/pages/shared/PiDetailPage"
import { BackorderUploadPage } from "@/pages/ops/BackorderUploadPage"
import { ReadyToShipPage } from "@/pages/shared/ready-to-ship/ReadyToShipPage"
import { ActualContainersPage } from "@/pages/shared/actual-containers/ActualContainersPage"
import { ActualContainerDetailPage } from "@/pages/shared/actual-containers/ActualContainerDetailPage"

function HomeRedirect() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return null
  }
  if (!user) {
    return <Navigate to="/login" replace />
  }
  return <Navigate to={user.role === "ops" ? "/ops" : "/client"} replace />
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/ops"
        element={
          <ProtectedRoute allowedRole="ops">
            <OpsLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="pi" replace />} />
        <Route path="pi" element={<PiListPage />} />
        <Route path="pi/:id" element={<PiDetailPage />} />
        <Route path="ready-to-ship" element={<ReadyToShipPage />} />
        <Route path="actual-containers" element={<ActualContainersPage />} />
        <Route
          path="actual-containers/:id"
          element={<ActualContainerDetailPage />}
        />
        <Route path="backorder-upload" element={<BackorderUploadPage />} />
      </Route>

      <Route
        path="/client"
        element={
          <ProtectedRoute allowedRole="client">
            <ClientLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="pi" replace />} />
        <Route path="pi" element={<PiListPage />} />
        <Route path="pi/:id" element={<PiDetailPage />} />
        <Route path="ready-to-ship" element={<ReadyToShipPage />} />
        <Route path="actual-containers" element={<ActualContainersPage />} />
        <Route
          path="actual-containers/:id"
          element={<ActualContainerDetailPage />}
        />
      </Route>

      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  )
}

export default App
