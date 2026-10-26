import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, downloadFile, errorMessage, items, mediaUrl } from '../services/api'
import { useFetch } from '../hooks/useFetch'
import { useApp } from '../contexts/AppContext'
import { Alert, Empty, ErrorState, Skeleton } from '../components/ui'

const GRADING_SCALE = [
  { range: '80 – 100', grade: 'A', remark: 'EXCELLENT' },
  { range: '70 – 79', grade: 'B', remark: 'VERY GOOD' },
  { range: '60 – 69', grade: 'C', remark: 'GOOD' },
  { range: '50 – 59', grade: 'D', remark: 'FAIR' },
  { range: '0 – 49', grade: 'E', remark: 'POOR' },
]

const A_LEVEL_GRADING_SCALE = [
  { range: '80 – 100', grade: 'A', points: 6, remark: 'EXCELLENT' },
  { range: '70 – 79', grade: 'B', points: 5, remark: 'VERY GOOD' },
  { range: '60 – 69', grade: 'C', points: 4, remark: 'GOOD' },
  { range: '50 – 59', grade: 'D', points: 3, remark: 'FAIR' },
  { range: '40 – 49', grade: 'E', points: 2, remark: 'PASS' },
  { range: '35 – 39', grade: 'O', points: 1, remark: 'SUB PASS' },
  { range: '0 – 34', grade: 'F', points: 0, remark: 'FAIL' },
]

const IDENTIFIER_SCALE = [
  { ident: '3', range: '2.5 – 3.0', desc: 'OUTSTANDING' },
  { ident: '2', range: '1.5 – 2.4', desc: 'MODERATE' },
  { ident: '1', range: '1.0 – 1.4', desc: 'BASIC' },
]

function getIdentifierInfo(c1) {
  if (c1 == null) return { ident: '—', desc: '—', num: null }
  const raw = Math.round(Number(c1))
  if (raw <= 1) return { ident: 1, desc: 'BASIC', num: 1 }
  if (raw === 2) return { ident: 2, desc: 'MODERATE', num: 2 }
  return { ident: 3, desc: 'OUTSTANDING', num: 3 }
}

function gradePreview(tot) {
  if (tot == null || tot === '' || tot === '-' || tot === '—') return ''
  const n = Number(String(tot).replace('%', ''))
  if (isNaN(n)) return ''
  if (n >= 80) return 'A'
  if (n >= 70) return 'B'
  if (n >= 60) return 'C'
  if (n >= 50) return 'D'
  return 'E'
}

function remarkPreview(g) {
  return { A: 'EXCELLENT', B: 'VERY GOOD', C: 'GOOD', D: 'FAIR', E: 'POOR' }[g] || ''
}

// Look up a component value case-insensitively across raw_components and components objects.
// Exam type codes (BOT, MID, FINAL, etc.) may arrive with varying key casing.
const compVal = (objs, ...cands) => {
  for (const obj of objs) {
    if (!obj || typeof obj !== 'object') continue
    for (const cand of cands) {
      if (obj[cand] != null) return Number(obj[cand])
      const ik = Object.keys(obj).find((k) => String(k).toUpperCase() === String(cand).toUpperCase())
      if (ik && obj[ik] != null) return Number(obj[ik])
    }
  }
  return null
}

export function SingleReportCard({ student, school }) {
  const report = student.report || {}
  const subjects = report.subjects || []
  const isALevel = /s\.?[56]|senior\s*[56]/i.test(report.class_name || student.stream_label || '')
  const logoSrc = '/kiyingi_logo.png'
  const studentPhoto = student.photo ? mediaUrl(student.photo) : null

  return (
    <article className="report-card-print-page">
      {/* Top Header */}
      <div className="rc-header">
        <div>
          <img src={logoSrc} alt="School Crest" className="rc-logo" onError={(e) => { e.target.style.display = 'none' }} />
        </div>
        <div className="rc-title-area">
          <h2 className="rc-school-name">{school?.name || 'KIYINGI MEMORIAL SECONDARY SCHOOL'}</h2>
          <div className="rc-school-location">3KM ALONG WABUSAANA-KYAMBOGO ROAD FROM KAKOOGE TOWNSHIP</div>
          <div className="rc-school-meta">
            <span>P.O.BOX KAMPALA UGANDA</span>
            <span className="rc-school-phone">TEL:0772511555/0701511555</span>
          </div>
          <div className="rc-motto">**Search for wisdom**</div>
          <div className="rc-term-title">
            <u>END OF TERM {(report.term_name || 'TWO').toUpperCase()} ASSESSMENT REPORT CARD {report.year_name || '2026'}</u>
          </div>
        </div>
        <div>
          {studentPhoto ? (
            <img src={studentPhoto} alt={student.name} className="rc-photo" />
          ) : (
            <div className="rc-photo-placeholder">STUDENT<br />PHOTO</div>
          )}
        </div>
      </div>

      {/* Student Details */}
      {isALevel ? (
        <>
          <div className="rc-card-banner">
            UGANDA ADVANCED CERTIFICATE OF EDUCATION (A-LEVEL) REPORT
          </div>
          <div className="rc-meta-grid">
            <div className="rc-meta-item">
              <span className="lbl">Student Name</span>
              <span className="val">{student.name}</span>
            </div>
            <div className="rc-meta-item">
              <span className="lbl">Index Number</span>
              <span className="val">{student.index_no}</span>
            </div>
            <div className="rc-meta-item">
              <span className="lbl">Candidate No.</span>
              <span className="val">{student.candidate_no || '—'}</span>
            </div>
            <div className="rc-meta-item">
              <span className="lbl">Gender</span>
              <span className="val">{student.gender === 'M' ? 'Male' : student.gender === 'F' ? 'Female' : '—'}</span>
            </div>
            <div className="rc-meta-item">
              <span className="lbl">Class / Stream</span>
              <span className="val">{student.stream_label || report.class_name || '—'}</span>
            </div>
            <div className="rc-meta-item">
              <span className="lbl">Academic Year</span>
              <span className="val">{report.year_name || '2026'}</span>
            </div>
            <div className="rc-meta-item">
              <span className="lbl">Term</span>
              <span className="val">{report.term_name || 'Term 1'}</span>
            </div>
            <div className="rc-meta-item">
              <span className="lbl">Class Position</span>
              <span className="val">{report.position ? `${report.position.rank} of ${report.position.out_of}` : (student.position ? `${student.position} in stream` : '—')}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="rc-student-bio">
          <div><b>NAME:</b> {student.name?.toUpperCase()}</div>
          <div><b>CLASS:</b> {(report.class_name || student.stream_label || '').toUpperCase()}</div>
        </div>
      )}

      {/* Performance Records Section Heading */}
      <div className="rc-section-heading">PERFORMANCE RECORDS</div>

      {/* Performance Table */}
      {isALevel ? (
        <table className="rc-table">
          <thead>
            <tr>
              <th style={{ width: '32%', textAlign: 'left' }}>SUBJECT</th>
              <th style={{ width: '15%' }}>PAPERS (PP1/PP2/PP3)</th>
              <th style={{ width: '10%' }}>TOTAL %</th>
              <th style={{ width: '10%' }}>GRADE</th>
              <th style={{ width: '10%' }}>POINTS</th>
              <th style={{ width: '15%' }}>REMARK</th>
              <th style={{ width: '8%' }}>INITIALS</th>
            </tr>
          </thead>
          <tbody>
            {subjects.length ? subjects.map((sub, i) => {
              const compCodes = Object.keys(sub.components || {})
              const papersStr = compCodes.length ? compCodes.map((c) => `${c}: ${sub.components[c]}%`).join(', ') : '—'
              const pts = sub.grade === 'A' ? 6 : sub.grade === 'B' ? 5 : sub.grade === 'C' ? 4 : sub.grade === 'D' ? 3 : sub.grade === 'E' ? 2 : sub.grade === 'O' ? 1 : 0
              return (
                <tr key={i}>
                  <td className="sub-name">{sub.subject}</td>
                  <td>{papersStr}</td>
                  <td><b>{sub.total}%</b></td>
                  <td><b>{sub.grade}</b></td>
                  <td>{pts}</td>
                  <td>{sub.remark}</td>
                  <td>KM</td>
                </tr>
              )
            }) : (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 12 }}>No assessment marks recorded for this term.</td></tr>
            )}
            <tr className="total-row">
              <td colSpan={2} style={{ textAlign: 'right' }}>OVERALL TOTAL / AVERAGE:</td>
              <td><b>{report.average != null ? `${report.average}%` : `${student.average || 0}%`}</b></td>
              <td><b>{report.grade || student.grade || '—'}</b></td>
              <td colSpan={3} style={{ textAlign: 'left', paddingLeft: 8 }}>
                <b>Rank: {report.position ? `${report.position.rank} / ${report.position.out_of}` : '—'}</b>
              </td>
            </tr>
          </tbody>
        </table>
      ) : (
        /* O-Level Template matching the reference image:
           SUBJECT | Mid-term | C1 | AVG | IDENT | DESCRIPTOR | BOT | 80% | 100% | GRADE | REMARK | TEACHER'S INITIALS */
        <table className="rc-table">
          <thead>
            <tr>
              <th style={{ width: '22%', textAlign: 'left' }}>SUBJECT</th>
              <th style={{ width: '7%' }}>Mid-term</th>
              <th style={{ width: '6.5%' }}>C1</th>
              <th style={{ width: '6.5%' }}>AVG</th>
              <th style={{ width: '6.5%' }}>IDENT</th>
              <th style={{ width: '15%' }}>DESCRIPTOR</th>
              <th style={{ width: '6.5%' }}>BOT</th>
              <th style={{ width: '7%' }}>80%</th>
              <th style={{ width: '7.5%' }}>100%</th>
              <th style={{ width: '7%' }}>GRADE</th>
              <th style={{ width: '10.5%' }}>REMARK</th>
              <th style={{ width: '8%' }}>TEACHER'S<br />INITIALS</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const identList = []
              const avgList = []
              const rows = subjects.length ? subjects.map((sub, i) => {
                const rawComps = sub.raw_components || {}
                const comps = sub.components || {}
                // 20% column: Mid-Term marks entered out of 20
                const botVal = compVal([rawComps, comps], 'BOT', 'BEGINNING_OF_TERM', 'B_O_T')
                const midVal = compVal([rawComps, comps], 'MID', 'MIDTERM', 'MID_TERM', 'M_T', 'MID-TERM')
                const col20 = midVal != null ? midVal : null

                // 80% column: End of term examination (out of 80)
                const eotVal = compVal([rawComps, comps], 'FINAL', 'EOT', 'END_OF_TERM', 'END', 'E_O_T')

                // 100% column: Mid-Term (out of 20) + End of term (out of 80) = FINAL RESULTS out of 100
                // BOT is optional and does NOT contribute to the final term results (excluded from 100%)
                // sub.total from backend includes BOT, so we compute Mid-term + EOT directly here.
                const final100 = col20 != null && eotVal != null
                  ? (col20 + eotVal)
                  : (eotVal != null ? eotVal : (col20 != null ? col20 : null))

                // C1 calculated as ((marks obtained/20)*3)
                const c1Raw = sub.c1 != null
                  ? Number(sub.c1)
                  : (col20 != null ? (col20 / 20.0) * 3.0 : (comps['C1'] != null ? Number(comps['C1']) : null))
                const c1 = c1Raw != null ? Number(c1Raw.toFixed(1)) : null

                // C2: BOT marks out of 20 converted to C2
                const c2Raw = sub.c2 != null
                  ? Number(sub.c2)
                  : (botVal != null ? (botVal / 20.0) * 3.0 : null)
                const c2 = c2Raw != null ? Number(c2Raw.toFixed(1)) : null

                // AVG: Continuous assessment average between C1 and C2
                const avgRaw = (c1 != null && c2 != null) ? (c1 + c2) / 2.0 : (c1 != null ? c1 : c2)
                const avg = avgRaw != null ? Number(avgRaw.toFixed(1)) : null
                if (avg != null) avgList.push(avg)

                // IDENT is AVG (or C1) rounded to nearest integer (0-1: BASIC, 2: MODERATE, 3: OUTSTANDING)
                const subIdInfo = getIdentifierInfo(avg != null ? avg : c1)
                if (subIdInfo.num != null) identList.push(subIdInfo.num)

                const initials = sub.teacher_initials || sub.initials || 'KM'
                const finalGrade = (sub.grade && sub.grade !== '-' && sub.grade !== '—')
                  ? sub.grade
                  : (final100 != null ? gradePreview(final100) : '')
                const finalRemark = (sub.remark && sub.remark !== '-' && sub.remark !== '—')
                  ? sub.remark
                  : (finalGrade ? remarkPreview(finalGrade) : '')

                return (
                  <tr key={i}>
                    <td className="sub-name">{sub.subject}</td>
                    <td>{col20 != null ? col20 : ''}</td>
                    <td>{c1 != null ? c1 : ''}</td>
                    <td>{avg != null ? avg : ''}</td>
                    <td><b>{subIdInfo.ident !== '—' ? subIdInfo.ident : ''}</b></td>
                    <td style={{ fontSize: '9px', textAlign: 'center', fontWeight: 600 }}>{subIdInfo.desc !== '—' ? subIdInfo.desc : ''}</td>
                    <td>{c2 != null ? c2 : ''}</td>
                    <td>{eotVal != null ? eotVal : ''}</td>
                    <td><b>{final100 != null ? `${final100}` : ''}</b></td>
                    <td><b>{finalGrade}</b></td>
                    <td>{finalRemark}</td>
                    <td>{initials}</td>
                  </tr>
                )
              }) : (
                <tr><td colSpan={12} style={{ textAlign: 'center', padding: 12 }}>No assessment marks recorded for this term.</td></tr>
              )

              const overallAvgVal = report.average != null
                ? report.average
                : (avgList.length ? (avgList.reduce((a, b) => a + b, 0) / avgList.length).toFixed(1) : '')

              return (
                <>
                  {rows}
                  <tr className="total-row">
                    <td style={{ fontWeight: 700, textAlign: 'left' }}>AVERAGE</td>
                    <td></td>
                    <td></td>
                    <td style={{ fontWeight: 700 }}>{overallAvgVal}</td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                </>
              )
            })()}
          </tbody>
        </table>
      )}

      {/* Summary Competency Box for A-Level */}
      {isALevel && (() => {
        const identList = []
        subjects.forEach((sub) => {
          const rawComps = sub.raw_components || {}
          const comps = sub.components || {}
          const botVal = compVal([rawComps, comps], 'BOT', 'BEGINNING_OF_TERM', 'B_O_T')
          const midVal = compVal([rawComps, comps], 'MID', 'MIDTERM', 'MID_TERM', 'M_T', 'MID-TERM')
          const col20 = midVal != null ? midVal : null
          const c1Raw = sub.c1 != null ? Number(sub.c1) : (col20 != null ? (col20 / 20.0) * 3.0 : (comps['C1'] != null ? Number(comps['C1']) : null))
          const c1 = c1Raw != null ? Number(c1Raw.toFixed(1)) : null
          const c2Raw = sub.c2 != null ? Number(sub.c2) : (botVal != null ? (botVal / 20.0) * 3.0 : c1)
          const c2 = c2Raw != null ? Number(c2Raw.toFixed(1)) : c1
          const avgRaw = (c1 != null && c2 != null) ? (c1 + c2) / 2.0 : (c1 != null ? c1 : c2)
          const avg = avgRaw != null ? Number(avgRaw.toFixed(1)) : null
          const subIdInfo = getIdentifierInfo(avg != null ? avg : c1)
          if (subIdInfo.num != null) identList.push(subIdInfo.num)
        })
        const overallIdentSum = identList.length ? identList.reduce((acc, v) => acc + v, 0) : '—'

        return (
          <div className="rc-summary-grid">
            <div className="rc-summary-item">
              <div className="s-lbl">Overall Average</div>
              <div className="s-val">{report.average != null ? `${report.average}%` : `${student.average || 0}%`}</div>
            </div>
            <div className="rc-summary-item">
              <div className="s-lbl">Overall Grade</div>
              <div className="s-val">{report.grade || student.grade || '—'}</div>
            </div>
            <div className="rc-summary-item">
              <div className="s-lbl">Overall Identifier</div>
              <div className="s-val">{overallIdentSum}</div>
            </div>
            <div className="rc-summary-item">
              <div className="s-lbl">Overall Achievement</div>
              <div className="s-val" style={{ fontSize: '11px', lineHeight: 1.2 }}>
                &nbsp;
              </div>
            </div>
          </div>
        )
      })()}

      {/* Summary Strip for O-Level matching the reference image */}
      {!isALevel && (() => {
        const identList = []
        subjects.forEach((sub) => {
          const rawComps = sub.raw_components || {}
          const comps = sub.components || {}
        const botVal = compVal([rawComps, comps], 'BOT', 'BEGINNING_OF_TERM', 'B_O_T')
        const midVal = compVal([rawComps, comps], 'MID', 'MIDTERM', 'MID_TERM', 'M_T', 'MID-TERM')
        const col20 = midVal != null ? midVal : null
          const c1Raw = sub.c1 != null ? Number(sub.c1) : (col20 != null ? (col20 / 20.0) * 3.0 : (comps['C1'] != null ? Number(comps['C1']) : null))
          const c1 = c1Raw != null ? Number(c1Raw.toFixed(1)) : null
          const c2Raw = sub.c2 != null ? Number(sub.c2) : (botVal != null ? (botVal / 20.0) * 3.0 : null)
          const c2 = c2Raw != null ? Number(c2Raw.toFixed(1)) : null
          const avgRaw = (c1 != null && c2 != null) ? (c1 + c2) / 2.0 : (c1 != null ? c1 : c2)
          const avg = avgRaw != null ? Number(avgRaw.toFixed(1)) : null
          const subIdInfo = getIdentifierInfo(avg != null ? avg : c1)
          if (subIdInfo.num != null) identList.push(subIdInfo.num)
        })
        const overallIdentSum = identList.length ? identList.reduce((acc, v) => acc + v, 0) : ''
        const overallAvgNum = report.average != null
          ? Number(report.average)
          : (avgList.length ? (avgList.reduce((a, b) => a + b, 0) / avgList.length) : null)
        const overallGrade = (report.grade && report.grade !== '-' && report.grade !== '—')
          ? report.grade
          : (overallAvgNum != null ? gradePreview(overallAvgNum) : (student.grade || ''))

        return (
          <table className="rc-summary-strip">
            <tbody>
              <tr>
                <td className="strip-lbl">OVERALL IDENTIFIER</td>
                <td className="strip-val">{overallIdentSum}</td>
                <td className="strip-lbl">OVERALL ACHIEVEMENT</td>
                <td className="strip-val">{report.achievement || ''}</td>
                <td className="strip-lbl">GRADE</td>
                <td className="strip-val">{overallGrade}</td>
              </tr>
            </tbody>
          </table>
        )
      })()}

      {/* Comments & Signatures for A-Level */}
      {isALevel && (
        <div className="rc-comments-box">
          <div className="rc-comment-row">
            <b>Class Teacher's Remark:</b>
            <span>{report.teacher_comment || 'Satisfactory academic performance and steady class participation. Encouraged to aim higher.'}</span>
            <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', color: '#6b7280', fontSize: '9.5px' }}>
              <span>Signature: _______________________</span>
              <span>Date: _______________________</span>
            </div>
          </div>
          <div className="rc-comment-row">
            <b>Headteacher's Remark:</b>
            <span>{report.head_comment || 'A commendable term\'s effort. Continue to work hard in the coming term to excel.'}</span>
            <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', color: '#6b7280', fontSize: '9.5px' }}>
              <span>Signature: _______________________</span>
              <span>Date: _______________________</span>
            </div>
          </div>
        </div>
      )}

      {/* Grading Scale Footnote */}
      <div style={{ marginTop: 6 }}>
        {isALevel ? (
          <div>
            <div style={{ fontSize: '9.5px', fontWeight: 700, color: '#374151', textTransform: 'uppercase' }}>Official Grading Scale & Points:</div>
            <table className="rc-grading-scale">
              <thead>
                <tr>
                  {A_LEVEL_GRADING_SCALE.map((g) => <th key={g.grade}>{g.range}%</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {A_LEVEL_GRADING_SCALE.map((g) => <td key={g.grade}><b>{g.grade}</b> ({g.points} Pts)</td>)}
                </tr>
                <tr>
                  {A_LEVEL_GRADING_SCALE.map((g) => <td key={g.grade} style={{ fontSize: '8.5px' }}>{g.remark}</td>)}
                </tr>
              </tbody>
            </table>
            <div style={{ fontSize: '8.5px', color: '#4b5563', marginTop: 3, fontStyle: 'italic' }}>
              Subsidiary Subjects (General Paper / Sub-Maths / ICT): Score &ge; 50 = Credit (1 Pt) | 40 – 49 = Pass | 0 – 39 = F (Fail)
            </div>
          </div>
        ) : (
          <div>
            <div className="rc-scale-title">GRADING SCALE</div>
            <table className="rc-grade-scale-table">
              <tbody>
                <tr>
                  {GRADING_SCALE.map((g) => <td key={g.grade}>{g.range}</td>)}
                </tr>
                <tr>
                  {GRADING_SCALE.map((g) => <td key={g.grade}><b>{g.grade}</b></td>)}
                </tr>
              </tbody>
            </table>

            <table className="rc-ident-scale-table">
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>IDENTIFIER</th>
                  <th style={{ width: '35%' }}>SCORE RANGE</th>
                  <th style={{ width: '35%' }}>DESCRIPTION</th>
                </tr>
              </thead>
              <tbody>
                {IDENTIFIER_SCALE.map((sc) => (
                  <tr key={sc.ident}>
                    <td><b>{sc.ident}</b></td>
                    <td>{sc.range}</td>
                    <td><b>{sc.desc}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Comments & Signatures matching the reference image */}
            <div className="rc-comments-area">
              <div className="rc-comment-line">
                <span className="rc-comment-lead"><b>HEAD TEACHER'S COMMENT:</b></span>
                <span className="rc-comment-text">{report.head_comment || ''}</span>
                <span className="rc-comment-dots"></span>
                <span className="rc-comment-sign-lbl"><b>SIGN:</b></span>
                <span className="rc-comment-sign-dots"></span>
              </div>
              <div className="rc-comment-line">
                <span className="rc-comment-lead"><b>CLASS TEACHER'S COMMENT:</b></span>
                <span className="rc-comment-text">{report.teacher_comment || ''}</span>
                <span className="rc-comment-dots"></span>
                <span className="rc-comment-sign-lbl"><b>SIGN:</b></span>
                <span className="rc-comment-sign-dots"></span>
              </div>
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

/* =====================================================================
   Mid-Term Report Card (A4) — columns: Subject | 20 (Mid-Term) | C1 | AVG | IDENT | DESCRIPTOR | TR INITIALS
   ===================================================================== */
export function MidTermReportCard({ student, school }) {
  const report = student.report || {}
  const subjects = report.subjects || []
  const isALevel = /s\.?[56]|senior\s*[56]/i.test(report.class_name || student.stream_label || '')
  const logoSrc = '/kiyingi_logo.png'
  const studentPhoto = student.photo ? mediaUrl(student.photo) : null

  return (
    <article className="mt-report-page">
      {/* Top Header */}
      <div className="mt-header">
        <div className="mt-logo-col">
          <img src={logoSrc} alt="School Crest" className="mt-logo" onError={(e) => { e.target.style.display = 'none' }} />
        </div>
        <div className="mt-title-area">
          <h2 className="mt-school-name">{school?.name || 'KIYINGI MEMORIAL SECONDARY SCHOOL'}</h2>
          <div className="mt-school-location">3KM ALONG WABUSAANA-KYAMBOGO ROAD FROM KAKOOGE TOWNSHIP</div>
          <div className="mt-school-meta">
            <span>P.O.BOX KAMPALA UGANDA</span>
            <span className="mt-school-phone">TEL:0772511555/0701511555</span>
          </div>
          <div className="mt-motto">**Search for wisdom**</div>
          <div className="mt-term-title">
            <u>MID-TERM ASSESSMENT REPORT CARD {(report.term_name || 'TWO').toUpperCase()} — {report.year_name || '2026'}</u>
          </div>
        </div>
        <div className="mt-photo-col">
          {studentPhoto ? (
            <img src={studentPhoto} alt={student.name} className="mt-photo" />
          ) : (
            <div className="mt-photo-placeholder">STUDENT<br />PHOTO</div>
          )}
        </div>
      </div>

      {/* Student Bio */}
      <div className="mt-student-bio">
        <div><b>NAME:</b> {student.name?.toUpperCase()}</div>
        <div><b>CLASS:</b> {(report.class_name || student.stream_label || '').toUpperCase()}</div>
        <div><b>INDEX No:</b> {student.index_no}</div>
        <div><b>GENDER:</b> {student.gender === 'M' ? 'Male' : student.gender === 'F' ? 'Female' : '—'}</div>
        <div><b>TERM:</b> {report.term_name || 'Term 1'}</div>
      </div>

      {/* Performance Table */}
      <div className="mt-section-heading">PERFORMANCE RECORDS — MID-TERM</div>
      <table className="mt-table">
        <thead>
          <tr>
            <th style={{ width: '34%', textAlign: 'left' }}>SUBJECT</th>
            <th style={{ width: '14%' }}>20</th>
            <th style={{ width: '10%' }}>C1</th>
            <th style={{ width: '11%' }}>AVG</th>
            <th style={{ width: '9%' }}>IDENT</th>
            <th style={{ width: '12%' }}>DESCRIPTOR</th>
            <th style={{ width: '10%' }}>TR INITIALS</th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            const identList = []
            const avgList = []
            const rows = subjects.length ? subjects.map((sub, i) => {
              const rawComps = sub.raw_components || {}
              const comps = sub.components || {}
              const botVal = compVal([rawComps, comps], 'BOT', 'BEGINNING_OF_TERM', 'B_O_T')
              const midVal = compVal([rawComps, comps], 'MID', 'MIDTERM', 'MID_TERM', 'M_T', 'MID-TERM')
              const col20 = midVal != null ? midVal : null

              const c1Raw = sub.c1 != null ? Number(sub.c1) : (col20 != null ? (col20 / 20.0) * 3.0 : (comps['C1'] != null ? Number(comps['C1']) : null))
              const c1 = c1Raw != null ? Number(c1Raw.toFixed(1)) : null
              const avgRaw = c1 != null ? c1 : null
              const avg = avgRaw != null ? Number(avgRaw.toFixed(1)) : null
              const subIdInfo = getIdentifierInfo(avg != null ? avg : c1)
              if (subIdInfo.num != null) identList.push(subIdInfo.num)
              if (avg != null) avgList.push(avg)

              const initials = sub.teacher_initials || sub.initials || 'KM'

              return (
                <tr key={i}>
                  <td className="sub-name">{sub.subject}</td>
                  <td>{col20 != null ? col20 : ''}</td>
                  <td>{c1 != null ? c1 : ''}</td>
                  <td>{avg != null ? avg : ''}</td>
                  <td><b>{subIdInfo.ident !== '—' ? subIdInfo.ident : ''}</b></td>
                  <td style={{ fontSize: '9px', textAlign: 'center', fontWeight: 600 }}>{subIdInfo.desc !== '—' ? subIdInfo.desc : ''}</td>
                  <td>{initials}</td>
                </tr>
              )
            }) : (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 12 }}>No Mid-Term assessment marks recorded for this term.</td></tr>
            )

            const overallAvgVal = avgList.length ? (avgList.reduce((a, b) => a + b, 0) / avgList.length).toFixed(1) : ''

            return (
              <>
                {rows}
                <tr className="mt-total-row">
                  <td style={{ fontWeight: 700, textAlign: 'left' }}>AVERAGE</td>
                  <td></td><td></td>
                  <td style={{ fontWeight: 700 }}>{overallAvgVal}</td>
                  <td></td><td></td><td></td>
                </tr>
              </>
            )
          })()}
        </tbody>
      </table>

      {/* Grading Scale */}
      <div style={{ marginTop: 6 }}>
        <div className="mt-scale-title">GRADING SCALE</div>
        <table className="mt-grade-scale-table">
          <tbody>
            <tr>
              {GRADING_SCALE.map((g) => <td key={g.grade}>{g.range}</td>)}
            </tr>
            <tr>
              {GRADING_SCALE.map((g) => <td key={g.grade}><b>{g.grade}</b></td>)}
            </tr>
          </tbody>
        </table>

        <table className="mt-ident-scale-table">
          <thead>
            <tr>
              <th style={{ width: '30%' }}>IDENTIFIER</th>
              <th style={{ width: '35%' }}>SCORE RANGE</th>
              <th style={{ width: '35%' }}>DESCRIPTION</th>
            </tr>
          </thead>
          <tbody>
            {IDENTIFIER_SCALE.map((sc) => (
              <tr key={sc.ident}>
                <td><b>{sc.ident}</b></td>
                <td>{sc.range}</td>
                <td><b>{sc.desc}</b></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Comments & Signatures */}
        <div className="mt-comments-area">
          <div className="mt-comment-line">
            <span className="mt-comment-lead"><b>HEAD TEACHER'S COMMENT:</b></span>
            <span className="mt-comment-text">{report.head_comment || ''}</span>
            <span className="mt-comment-dots"></span>
            <span className="mt-comment-sign-lbl"><b>SIGN:</b></span>
            <span className="mt-comment-sign-dots"></span>
          </div>
          <div className="mt-comment-line">
            <span className="mt-comment-lead"><b>CLASS TEACHER'S COMMENT:</b></span>
            <span className="mt-comment-text">{report.teacher_comment || ''}</span>
            <span className="mt-comment-dots"></span>
            <span className="mt-comment-sign-lbl"><b>SIGN:</b></span>
            <span className="mt-comment-sign-dots"></span>
          </div>
        </div>
      </div>
    </article>
  )
}

export function AdminStudentReportsPage() {
  const { school } = useApp()
  const years = useFetch('/academics/years/')
  const terms = useFetch('/academics/terms/')
  const classes = useFetch('/academics/classes/')
  const streams = useFetch('/academics/streams/')

  const [yearId, setYearId] = useState('')
  const [termId, setTermId] = useState('')
  const [selectedClassId, setSelectedClassId] = useState('')
  const [selectedStreamId, setSelectedStreamId] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [genderFilter, setGenderFilter] = useState('')

  const [downloadingZip, setDownloadingZip] = useState(false)
  const [downloadingPdfId, setDownloadingPdfId] = useState(null)
  const [alertMsg, setAlertMsg] = useState({ kind: '', text: '' })
  const [printStudents, setPrintStudents] = useState(null)
  const [reportType, setReportType] = useState('end_of_term')

  // Initialize active year & term
  useEffect(() => {
    const termList = items(terms.data)
    if (termList.length && !termId) {
      const active = termList.find((t) => t.is_active) || termList[0]
      setTermId(String(active.id))
      setYearId(String(active.year))
    }
  }, [terms.data, termId])

  // Filter terms by selected year
  const availableTerms = useMemo(() => {
    const all = items(terms.data)
    return yearId ? all.filter((t) => String(t.year) === String(yearId)) : all
  }, [terms.data, yearId])

  // Sort classes: prioritize S1–S6
  const sortedClasses = useMemo(() => {
    const raw = items(classes.data)
    const priority = (name) => {
      const m = name.match(/^(?:s\.?|senior\s*)([1-6])/i)
      return m ? parseInt(m[1], 10) : 99
    }
    return [...raw].sort((a, b) => {
      const pa = priority(a.name)
      const pb = priority(b.name)
      if (pa !== pb) return pa - pb
      return a.name.localeCompare(b.name)
    })
  }, [classes.data])

  // Set default selected class (e.g. S1)
  useEffect(() => {
    if (sortedClasses.length && !selectedClassId) {
      setSelectedClassId(String(sortedClasses[0].id))
    }
  }, [sortedClasses, selectedClassId])

  const activeClass = sortedClasses.find((c) => String(c.id) === String(selectedClassId))
  const activeTerm = items(terms.data).find((t) => String(t.id) === String(termId))

  // Streams for the selected class
  const classStreams = useMemo(() => {
    if (!selectedClassId) return []
    return items(streams.data).filter((s) => String(s.school_class) === String(selectedClassId))
  }, [streams.data, selectedClassId])

  // Reset stream when class changes
  useEffect(() => {
    setSelectedStreamId('')
  }, [selectedClassId])

  // Fetch student roster and summaries
  const queryParams = useMemo(() => {
    if (!termId || (!selectedClassId && !selectedStreamId)) return null
    const p = { term: termId, detailed: '1' }
    if (selectedStreamId) {
      p.stream = selectedStreamId
    } else {
      p.school_class = selectedClassId
    }
    return p
  }, [termId, selectedClassId, selectedStreamId])

  const { data: studentList, loading, error, reload } = useFetch(queryParams ? '/results/class-summary/' : null, queryParams)

  // Filter students by local search & gender
  const filteredStudents = useMemo(() => {
    let list = Array.isArray(studentList) ? studentList : []
    if (genderFilter) {
      list = list.filter((s) => s.gender === genderFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((s) => s.name.toLowerCase().includes(q) || s.index_no.toLowerCase().includes(q) || (s.candidate_no && s.candidate_no.toLowerCase().includes(q)))
    }
    return list
  }, [studentList, genderFilter, searchQuery])

  // Bulk ZIP Download
  const handleDownloadClassZip = async () => {
    if (!selectedClassId || !termId) return
    setDownloadingZip(true)
    setAlertMsg({ kind: '', text: '' })
    try {
      const className = activeClass?.name || `Class-${selectedClassId}`
      const termName = activeTerm?.name || `Term-${termId}`
      await downloadFile(`/reports/class-report-cards/${selectedClassId}/${termId}/`, `${className}-${termName}-Report-Cards.zip`)
      setAlertMsg({ kind: 'success', text: `Successfully generated and downloaded report cards ZIP for ${className}.` })
    } catch (e) {
      setAlertMsg({ kind: 'error', text: errorMessage(e, 'Failed to download class report cards ZIP.') })
    } finally {
      setDownloadingZip(false)
    }
  }

  // Single PDF Download
  const handleDownloadSinglePdf = async (student) => {
    if (!student?.id || !termId) return
    setDownloadingPdfId(student.id)
    try {
      await downloadFile(`/reports/report-card/${student.id}/${termId}/`, `Report-Card-${student.index_no}.pdf`)
    } catch (e) {
      alert(errorMessage(e, 'Failed to download report card PDF.'))
    } finally {
      setDownloadingPdfId(null)
    }
  }

  // Bulk Print Dialog
  const handlePrintAll = () => {
    if (!filteredStudents.length) {
      alert('No students to print.')
      return
    }
    setPrintStudents(filteredStudents)
  }

  // Single Student Print Dialog
  const handlePrintSingle = (student) => {
    setPrintStudents([student])
  }

  // Trigger window.print when printStudents modal is ready
  useEffect(() => {
    if (printStudents && printStudents.length > 0) {
      const timer = setTimeout(() => {
        window.print()
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [printStudents])

  return (
    <div className="stack">
      {/* Page Title & Navigation Header */}
      <div className="panel row spread" style={{ padding: '16px 20px' }}>
        <div>
          <h2>Student Directory & Bulk Report Cards</h2>
          <p className="muted" style={{ margin: 0 }}>
            Manage registered students from S1 through S6, generate bulk report cards, download class ZIP archives, and print directly.
          </p>
        </div>
        <div className="row">
          <Link to="/admin/students" className="btn sm">All Students Directory</Link>
          <Link to="/admin/classes" className="btn sm">Manage Classes</Link>
        </div>
      </div>

      {alertMsg.text && <Alert kind={alertMsg.kind}>{alertMsg.text}</Alert>}

      {/* Academic Year and Term Selector */}
      <div className="panel row" style={{ gap: 16 }}>
        <label>
          <b>Academic Year:</b>{' '}
          <select
            className="input"
            style={{ width: 'auto', display: 'inline-block', marginLeft: 8 }}
            value={yearId}
            onChange={(e) => {
              setYearId(e.target.value)
              const firstT = items(terms.data).find((t) => String(t.year) === e.target.value)
              if (firstT) setTermId(String(firstT.id))
            }}
          >
            {items(years.data).map((y) => (
              <option key={y.id} value={y.id}>{y.name} {y.is_active ? '(Active)' : ''}</option>
            ))}
          </select>
        </label>

        <label>
          <b>Assessment Term:</b>{' '}
          <select
            className="input"
            style={{ width: 'auto', display: 'inline-block', marginLeft: 8 }}
            value={termId}
            onChange={(e) => setTermId(e.target.value)}
          >
            {availableTerms.map((t) => (
              <option key={t.id} value={t.id}>{t.name} {t.is_active ? '(Active Term)' : ''}</option>
            ))}
          </select>
        </label>

        {activeTerm?.is_active && (
          <span className="badge success" style={{ alignSelf: 'center' }}>Active Term</span>
        )}
      </div>

      {/* S1 to S6 Class Tabs with Accurate Student Counts */}
      <div className="panel" style={{ padding: '12px 16px' }}>
        <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
          {sortedClasses.map((cls) => {
            const isSelected = String(cls.id) === String(selectedClassId)
            return (
              <button
                key={cls.id}
                type="button"
                className="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedClassId(String(cls.id))}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: '14px',
                  fontWeight: isSelected ? 800 : 600,
                  borderBottom: isSelected ? '3px solid var(--primary)' : '3px solid transparent',
                }}
              >
                <span>{cls.name}</span>
                <span className={`badge ${isSelected ? 'info' : ''}`} style={{ fontSize: '11px' }}>
                  {cls.student_count != null ? cls.student_count : 0}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Sub-Filters and Bulk Action Bar */}
      <div className="panel row spread" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          {/* Stream Filter */}
          {classStreams.length > 0 && (
            <select
              className="input"
              style={{ width: 'auto' }}
              value={selectedStreamId}
              onChange={(e) => setSelectedStreamId(e.target.value)}
              aria-label="Filter by Stream"
            >
              <option value="">All Streams ({activeClass?.name})</option>
              {classStreams.map((st) => (
                <option key={st.id} value={st.id}>Stream {st.name}</option>
              ))}
            </select>
          )}

          {/* Gender Filter */}
          <select
            className="input"
            style={{ width: 'auto' }}
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value)}
            aria-label="Filter by Gender"
          >
            <option value="">All Genders</option>
            <option value="M">Male</option>
            <option value="F">Female</option>
          </select>

          {/* Search box */}
          <input
            className="input search"
            style={{ minWidth: 240 }}
            placeholder="Search student or index no..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Bulk Generation & Printing Buttons */}
        <div className="row" style={{ gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="report-type" value="end_of_term" checked={reportType === 'end_of_term'} onChange={() => setReportType('end_of_term')} />
            End of Term Report Card
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="radio" name="report-type" value="mid_term" checked={reportType === 'mid_term'} onChange={() => setReportType('mid_term')} />
            Mid-Term Report Card
          </label>
          <button
            className="btn primary"
            disabled={downloadingZip || !filteredStudents.length}
            onClick={handleDownloadClassZip}
            title="Download ZIP containing Report Cards for all students in this class"
          >
            {downloadingZip ? (
              <>
                <span className="spinner" style={{ width: 14, height: 14 }} />
                <span>Preparing ZIP...</span>
              </>
            ) : (
              <>
                <span>⬇</span> Download {activeClass?.name || 'Class'} Report Cards (ZIP)
              </>
            )}
          </button>

          <button
            className="btn"
            disabled={!filteredStudents.length}
            onClick={handlePrintAll}
            title="Open printable report cards for all students in this class and open browser print dialog"
          >
            🖨 Print {activeClass?.name || 'Class'} Report Cards
          </button>
        </div>
      </div>

      {/* Student List Table */}
      <section className="panel" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 24 }}>
            <Skeleton rows={6} />
          </div>
        ) : error ? (
          <div style={{ padding: 24 }}>
            <ErrorState message={error} onRetry={reload} />
          </div>
        ) : !filteredStudents.length ? (
          <div style={{ padding: 32 }}>
            <Empty title={`No students found in ${activeClass?.name || 'this class'}`} />
          </div>
        ) : (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>Photo</th>
                  <th>Student Name</th>
                  <th>Index No.</th>
                  <th>Candidate No.</th>
                  <th>Stream</th>
                  <th>Gender</th>
                  <th>Subjects</th>
                  <th>Average %</th>
                  <th>Grade</th>
                  <th>Rank</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((s) => {
                  const photoSrc = s.photo ? mediaUrl(s.photo) : null
                  return (
                    <tr key={s.id}>
                      <td>
                        {photoSrc ? (
                          <img
                            src={photoSrc}
                            alt=""
                            style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover' }}
                          />
                        ) : (
                          <div
                            className="avatar"
                            style={{ width: 34, height: 34, fontSize: 12 }}
                          >
                            {s.name.charAt(0)}
                          </div>
                        )}
                      </td>
                      <td>
                        <Link to={`/admin/students/${s.id}`} style={{ fontWeight: 600 }}>
                          {s.name}
                        </Link>
                      </td>
                      <td><code>{s.index_no}</code></td>
                      <td>{s.candidate_no ? <code>{s.candidate_no}</code> : <span className="muted">—</span>}</td>
                      <td>{s.stream_label || '—'}</td>
                      <td>{s.gender === 'M' ? 'Male' : s.gender === 'F' ? 'Female' : '—'}</td>
                      <td>{s.subjects != null ? s.subjects : '—'}</td>
                      <td><b>{s.average != null ? `${s.average}%` : '—'}</b></td>
                      <td>
                        {s.grade ? (
                          <span className={`badge ${s.grade === 'A' || s.grade === 'B' ? 'success' : s.grade === 'E' ? 'danger' : 'info'}`}>
                            {s.grade}
                          </span>
                        ) : '—'}
                      </td>
                      <td>{s.position != null ? `#${s.position}` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                          <button
                            className="btn sm"
                            disabled={downloadingPdfId === s.id}
                            onClick={() => handleDownloadSinglePdf(s)}
                            title="Download PDF report card"
                          >
                            {downloadingPdfId === s.id ? '…' : '⬇ PDF'}
                          </button>
                          <button
                            className="btn sm"
                            onClick={() => handlePrintSingle(s)}
                            title="Print this student's report card"
                          >
                            🖨 Print
                          </button>
                          <Link className="btn sm ghost" to={`/admin/students/${s.id}`}>
                            Profile
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Printable Report Cards Modal / View */}
      {printStudents && printStudents.length > 0 && (
        <div className="report-card-modal-backdrop">
          <div className="report-card-toolbar no-print">
            <button className="btn primary" onClick={() => window.print()}>
              🖨 Print ({printStudents.length} {printStudents.length === 1 ? 'Report Card' : 'Report Cards'})
            </button>
            <button className="btn" onClick={() => setPrintStudents(null)}>
              ✕ Close Preview
            </button>
            <span className="muted" style={{ fontSize: 13, marginLeft: 'auto' }}>
              Connected printer ready. Press Print to trigger the browser's normal print dialog.
            </span>
          </div>

          <div className="report-card-print-container">
            {printStudents.map((st) => (
              <div key={st.id} style={{ pageBreakAfter: 'always' }}>
                {reportType === 'mid_term' ? <MidTermReportCard student={st} school={school} /> : <SingleReportCard student={st} school={school} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

