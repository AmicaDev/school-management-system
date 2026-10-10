import { Suspense, lazy, useEffect } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { RedirectIfAuthed, RequireRole } from './routes/Guards'
import Shell from './layouts/Shell'
import { Skeleton } from './components/ui'
import ResourcePage from './features/ResourcePage'
import { R } from './features/resources'
import { reportClientError } from './services/api'

const lz = (loader, name) => lazy(() => loader().then((m) => ({ default: name ? m[name] : m.default })))
const Home = lz(() => import('./pages/Home'))
const Legal = lz(() => import('./pages/Home'), 'Legal')
const Login = lz(() => import('./pages/Auth'), 'Login')
const Register = lz(() => import('./pages/Auth'), 'Register')
const ForgotPassword = lz(() => import('./pages/Auth'), 'ForgotPassword')
const ResetPassword = lz(() => import('./pages/Auth'), 'ResetPassword')
const Logout = lz(() => import('./pages/Auth'), 'Logout')
const NotFound = lz(() => import('./pages/ErrorPages'), 'NotFound')
const Forbidden = lz(() => import('./pages/ErrorPages'), 'Forbidden')
const ServerError = lz(() => import('./pages/ErrorPages'), 'ServerError')
const OfflinePage = lz(() => import('./pages/ErrorPages'), 'OfflinePage')
const Maintenance = lz(() => import('./pages/ErrorPages'), 'Maintenance')
const A = {}
;['AdminDashboard', 'ClassesPage', 'SubjectsPage', 'AcademicsPage', 'GradingPage', 'RecycleBinPage', 'SchoolSettings', 'ImportPanel'].forEach((n) => { A[n] = lz(() => import('./features/admin'), n) })
const S = {}
;['StudentProfile', 'ClassResults', 'NotificationsPage', 'EventsPage', 'Enquiries', 'ParentProfile'].forEach((n) => { S[n] = lz(() => import('./features/Shared'), n) })
const T = {}
;['TeacherDashboard', 'Attendance', 'Marks'].forEach((n) => { T[n] = lz(() => import('./features/teacher'), n) })
const P = {}
;['ParentDashboard', 'ChildrenList', 'ParentAttendance', 'ParentResults', 'ParentPerformance'].forEach((n) => { P[n] = lz(() => import('./features/parent'), n) })
const D = {}
;['DevDashboard', 'DevErrors', 'DevLogs', 'DevTests', 'DevDatabase', 'DevApi', 'DevPwa', 'DevSync', 'DevMaintenance', 'DevUpdates', 'DevAudit'].forEach((n) => { D[n] = lz(() => import('./features/developer'), n) })

const rp = (cfg) => <ResourcePage cfg={cfg} />
const StudentsPage = () => (
  <div className="stack">
    <ResourcePage cfg={{ ...R.students, rowActions: (r) => <Link className="btn sm" to={`/admin/students/${r.id}`}>Profile</Link> }} />
    <A.ImportPanel kind="students" title="Bulk import students" columns={['first_name', 'last_name', 'gender', 'date_of_birth', 'class', 'stream', 'index_no', 'candidate_no']} note="gender is M or F; date format YYYY-MM-DD. Index numbers are generated if blank; candidate numbers are optional." />
  </div>
)
const TeachersPage = () => (
  <div className="stack">
    <ResourcePage cfg={R.teachers} />
    <A.ImportPanel kind="teachers" title="Bulk import teachers" columns={['username', 'first_name', 'last_name', 'gender', 'email', 'phone', 'password']} note="Leave password blank to generate a temporary one." />
  </div>
)
const ParentsPage = () => (
  <div className="stack">
    <ResourcePage cfg={R.parents} />
    <A.ImportPanel kind="parents" title="Bulk import parents" columns={['username', 'first_name', 'last_name', 'email', 'phone', 'password', 'children']} note="children = student index numbers separated by ;" />
  </div>
)
const TeacherClasses = () => <ResourcePage cfg={{ title: 'My students', endpoint: '/students/', readOnly: true, ordering: 'last_name', columns: R.students.columns.slice(0, 4) }} />
const dayCols = R.timetable.columns
const MyTimetable = () => <ResourcePage cfg={{ title: 'Timetable', endpoint: '/timetable/', readOnly: true, search: false, columns: dayCols }} />
const ParentAttendanceNote = P.ParentAttendance

export default function App() {
  useEffect(() => {
    const onErr = (e) => reportClientError(e.message || 'Unhandled error', { stack: e.error?.stack, module: 'window' })
    const onRej = (e) => reportClientError(String(e.reason?.message || e.reason || 'Unhandled rejection'), { stack: e.reason?.stack, module: 'promise' })
    window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onRej)
    return () => { window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej) }
  }, [])
  return (
    <Suspense fallback={<div className="content"><Skeleton rows={6} /></div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/privacy" element={<Legal kind="privacy" />} /><Route path="/terms" element={<Legal kind="terms" />} />
        <Route path="/login" element={<RedirectIfAuthed><Login /></RedirectIfAuthed>} />
        <Route path="/register" element={<Register />} /><Route path="/forgot-password" element={<ForgotPassword />} /><Route path="/reset-password" element={<ResetPassword />} /><Route path="/logout" element={<Logout />} />
        <Route path="/403" element={<Forbidden />} /><Route path="/500" element={<ServerError />} /><Route path="/offline" element={<OfflinePage />} /><Route path="/maintenance" element={<Maintenance />} />

        <Route element={<RequireRole roles={['ADMIN']} />}><Route element={<Shell />}>
          <Route path="/admin" element={<A.AdminDashboard />} />
          <Route path="/admin/students" element={<StudentsPage />} /><Route path="/admin/students/:id" element={<S.StudentProfile />} />
          <Route path="/admin/teachers" element={<TeachersPage />} /><Route path="/admin/parents" element={<ParentsPage />} /><Route path="/admin/staff" element={rp(R.staff)} />
          <Route path="/admin/recycle-bin" element={<A.RecycleBinPage />} />
          <Route path="/admin/classes" element={<A.ClassesPage />} /><Route path="/admin/subjects" element={<A.SubjectsPage />} /><Route path="/admin/academics" element={<A.AcademicsPage />} /><Route path="/admin/grading" element={<A.GradingPage />} />
          <Route path="/admin/attendance" element={rp(R.attendance)} /><Route path="/admin/results" element={<S.ClassResults downloads={false} />} /><Route path="/admin/reports" element={<S.ClassResults />} />
          <Route path="/admin/timetable" element={rp(R.timetable)} /><Route path="/admin/events" element={rp(R.events)} /><Route path="/admin/notifications" element={<S.NotificationsPage />} />
          <Route path="/admin/enquiries" element={<S.Enquiries />} /><Route path="/admin/analytics" element={<A.AdminDashboard view="analytics" />} />
          <Route path="/admin/settings" element={<A.SchoolSettings />} /><Route path="/admin/users" element={rp(R.users)} /><Route path="/admin/audit" element={rp(R.audit)} />
        </Route></Route>

        <Route element={<RequireRole roles={['TEACHER']} />}><Route element={<Shell />}>
          <Route path="/teacher" element={<T.TeacherDashboard />} /><Route path="/teacher/classes" element={<TeacherClasses />} />
          <Route path="/teacher/attendance" element={<T.Attendance />} /><Route path="/teacher/marks" element={<T.Marks />} /><Route path="/teacher/assignments" element={<T.Marks only={['ASSIGNMENT']} />} />
          <Route path="/teacher/timetable" element={<MyTimetable />} /><Route path="/teacher/notifications" element={<S.NotificationsPage />} /><Route path="/teacher/enquiries" element={<S.Enquiries />} />
        </Route></Route>

        <Route element={<RequireRole roles={['PARENT']} />}><Route element={<Shell />}>
          <Route path="/parent" element={<P.ParentDashboard />} /><Route path="/parent/children" element={<P.ChildrenList />} /><Route path="/parent/children/:id" element={<S.StudentProfile />} />
          <Route path="/parent/attendance" element={<ParentAttendanceNote />} /><Route path="/parent/results" element={<P.ParentResults />} /><Route path="/parent/performance" element={<P.ParentPerformance />} />
          <Route path="/parent/timetable" element={<MyTimetable />} /><Route path="/parent/events" element={<S.EventsPage />} /><Route path="/parent/notifications" element={<S.NotificationsPage />} /><Route path="/parent/enquiries" element={<S.Enquiries />} /><Route path="/parent/profile" element={<S.ParentProfile />} />
        </Route></Route>

        <Route element={<RequireRole roles={['DEVELOPER']} />}><Route element={<Shell />}>
          <Route path="/developer" element={<D.DevDashboard />} /><Route path="/developer/errors" element={<D.DevErrors />} /><Route path="/developer/logs" element={<D.DevLogs />} /><Route path="/developer/tests" element={<D.DevTests />} />
          <Route path="/developer/database" element={<D.DevDatabase />} /><Route path="/developer/api" element={<D.DevApi />} /><Route path="/developer/pwa" element={<D.DevPwa />} /><Route path="/developer/sync" element={<D.DevSync />} />
          <Route path="/developer/maintenance" element={<D.DevMaintenance />} /><Route path="/developer/updates" element={<D.DevUpdates />} /><Route path="/developer/audit" element={<D.DevAudit />} />
        </Route></Route>
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}
