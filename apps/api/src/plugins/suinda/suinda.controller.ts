import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { Request } from "express";
import type { Response } from "express";
import type { AccessRequest } from "../../access/access";
import type { Payload } from "../records/rules";
import { createAcademicReportPdf } from "./academic-report-pdf";
import { SuindaLearningService } from "./suinda.service";
import { SuindaCertificateSigningService } from "../suinda-certificate-signing";

@Controller("extensions")
export class SuindaLearningController {
  constructor(@Inject(SuindaLearningService) private readonly suinda: SuindaLearningService,
    @Inject(SuindaCertificateSigningService) private readonly certificateSigning: SuindaCertificateSigningService) {}

  @Get("suinda-learning/me/dashboard") dashboard(@Req() req: AccessRequest) {
    return this.suinda.learnerDashboard(String(req.orbitUser));
  }
  @Post("suinda-learning/workspaces/:workspaceId/staff-invitations") inviteStaffMember(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: Payload,
  ) {
    return this.suinda.inviteStaffMember(workspaceId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/portfolio") portfolio(@Req() req: AccessRequest) {
    return this.suinda.learnerPortfolio(String(req.orbitUser));
  }
  @Get("suinda-learning/me/transcript") transcript(@Req() req: AccessRequest) {
    return this.suinda.learnerTranscript(String(req.orbitUser));
  }
  @Get("suinda-learning/me/enrollments/:id/certificate-signature") certificateSignatureStatus(
    @Req() req: AccessRequest, @Param("id") enrollmentId: string,
  ) {
    return this.certificateSigning.learnerStatus(enrollmentId, String(req.orbitUser));
  }
  @Get("suinda-learning/me/recommendations") recommendations(@Req() req: AccessRequest) {
    return this.suinda.learnerRecommendations(String(req.orbitUser));
  }
  @Get("suinda-learning/me/learning-paths") learningPaths(@Req() req: AccessRequest) {
    return this.suinda.learnerPaths(String(req.orbitUser));
  }
  @Get("suinda-learning/me/seasons") seasons(@Req() req: AccessRequest) {
    return this.suinda.learnerSeasons(String(req.orbitUser));
  }
  @Get("suinda-learning/me/data-export") async learnerDataExport(@Req() req: AccessRequest, @Res() res: Response) {
    const data = await this.suinda.learnerDataExport(String(req.orbitUser));
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="suinda-dados-pessoais.json"');
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(JSON.stringify(data, null, 2));
  }
  @Get("suinda-learning/me/privacy-requests") privacyRequests(@Req() req: AccessRequest) {
    return this.suinda.learnerPrivacyRequests(String(req.orbitUser));
  }
  @Get("suinda-learning/me/privacy-workspaces") privacyWorkspaces(@Req() req: AccessRequest) {
    return this.suinda.privacyManagementWorkspaces(String(req.orbitUser));
  }
  @Post("suinda-learning/workspaces/:workspaceId/me/privacy-requests") createPrivacyRequest(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: Payload,
  ) {
    return this.suinda.createLearnerPrivacyRequest(workspaceId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/workspaces/:workspaceId/me/privacy-requests/:requestId/identity-challenge") beginPrivacyIdentityVerification(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("requestId") requestId: string, @Body() body: Payload,
  ) {
    return this.suinda.beginPrivacyIdentityVerification(workspaceId, requestId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/workspaces/:workspaceId/me/privacy-requests/:requestId/identity-challenge/verify") verifyPrivacyIdentity(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("requestId") requestId: string, @Body() body: Payload,
  ) {
    return this.suinda.confirmPrivacyIdentityVerification(workspaceId, requestId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/workspaces/:workspaceId/privacy-requests/:requestId/categories") decidePrivacyCategory(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("requestId") requestId: string, @Body() body: Payload,
  ) {
    return this.suinda.decidePrivacyCategory(workspaceId, requestId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/workspaces/:workspaceId/privacy-requests") privacyManagementRequests(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string,
  ) {
    return this.suinda.privacyManagementRequests(workspaceId, String(req.orbitUser));
  }
  @Post("suinda-learning/workspaces/:workspaceId/privacy-requests/:requestId/execute") executePrivacyRequest(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("requestId") requestId: string, @Body() body: Payload,
  ) {
    return this.suinda.executeApprovedPrivacyRequest(workspaceId, requestId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/privacy-notices") privacyNotices(@Req() req: AccessRequest) {
    return this.suinda.learnerPrivacyNotices(String(req.orbitUser));
  }
  @Get("suinda-learning/me/privacy-consents") privacyConsents(@Req() req: AccessRequest) {
    return this.suinda.learnerPrivacyConsents(String(req.orbitUser));
  }
  @Get("suinda-learning/workspaces/:workspaceId/privacy-retention-candidates") retentionCandidates(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Query("cursor") cursor?: string,
  ) {
    return this.suinda.privacyRetentionCandidates(workspaceId, String(req.orbitUser), cursor);
  }
  @Post("suinda-learning/workspaces/:workspaceId/me/privacy-notices/:noticeId/response") respondToPrivacyNotice(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("noticeId") noticeId: string, @Body() body: Payload,
  ) {
    return this.suinda.respondToPrivacyNotice(workspaceId, noticeId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/privacy-consents/:consentId/withdraw") withdrawPrivacyConsent(
    @Req() req: AccessRequest, @Param("consentId") consentId: string, @Body() body: Payload,
  ) {
    return this.suinda.withdrawPrivacyConsent(consentId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/announcements/:announcementId/read") confirmAnnouncementRead(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("announcementId") announcementId: string, @Body() body: Payload,
  ) {
    return this.suinda.confirmAnnouncementRead(id, announcementId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/profiles") learnerProfiles(@Req() req: AccessRequest) {
    return this.suinda.learnerProfiles(String(req.orbitUser));
  }
  @Put("suinda-learning/me/profiles/:workspaceId") saveLearnerProfile(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: Payload,
  ) {
    return this.suinda.saveLearnerProfile(workspaceId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/workspaces/:workspaceId/survey-reminder-policy") surveyReminderPolicy(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string,
  ) {
    return this.suinda.surveyReminderPolicy(workspaceId, String(req.orbitUser));
  }
  @Put("suinda-learning/workspaces/:workspaceId/survey-reminder-policy") saveSurveyReminderPolicy(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: Payload,
  ) {
    return this.suinda.saveSurveyReminderPolicy(workspaceId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/workspaces/:workspaceId/practice-credit-policy") practiceCreditPolicy(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string,
  ) {
    return this.suinda.practiceCreditPolicy(workspaceId, String(req.orbitUser));
  }
  @Put("suinda-learning/workspaces/:workspaceId/practice-credit-policy") savePracticeCreditPolicy(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: Payload,
  ) {
    return this.suinda.savePracticeCreditPolicy(workspaceId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/practice-credit-requests") ownPracticeCreditRequests(@Req() req: AccessRequest) {
    return this.suinda.ownPracticeCreditRequests(String(req.orbitUser));
  }
  @Post("suinda-learning/me/enrollments/:targetId/practice-credit-requests") createPracticeCreditRequest(
    @Req() req: AccessRequest, @Param("targetId") targetId: string, @Body() body: Payload,
  ) {
    return this.suinda.createPracticeCreditRequest(targetId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/workspaces/:workspaceId/practice-credit-requests") practiceCreditRequests(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string,
  ) {
    return this.suinda.practiceCreditRequests(workspaceId, String(req.orbitUser));
  }
  @Post("suinda-learning/workspaces/:workspaceId/practice-credit-requests/:requestId/review") reviewPracticeCreditRequest(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("requestId") requestId: string, @Body() body: Payload,
  ) {
    return this.suinda.reviewPracticeCreditRequest(workspaceId, requestId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/alumni") alumniEnrollments(@Req() req: AccessRequest) {
    return this.suinda.alumniEnrollments(String(req.orbitUser));
  }
  @Get("suinda-learning/me/alumni/enrollments/:id") alumniCommunity(@Req() req: AccessRequest, @Param("id") id: string) {
    return this.suinda.alumniCommunity(id, String(req.orbitUser));
  }
  @Post("suinda-learning/me/alumni/enrollments/:id/posts") createAlumniPost(
    @Req() req: AccessRequest, @Param("id") id: string, @Body() body: Payload,
  ) {
    return this.suinda.createAlumniPost(id, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/alumni/enrollments/:id/posts/:postId/replies") replyAlumniPost(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("postId") postId: string, @Body() body: Payload,
  ) {
    return this.suinda.replyAlumniPost(id, postId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/teaching-profiles") teachingProfiles(@Req() req: AccessRequest) {
    return this.suinda.teachingProfiles(String(req.orbitUser));
  }
  @Put("suinda-learning/me/teaching-profiles/:workspaceId") saveTeachingProfile(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: Payload,
  ) {
    return this.suinda.saveTeachingProfile(workspaceId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/workspaces/:workspaceId/staff-credentials") staffCredentials(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string) {
    return this.suinda.staffCredentials(workspaceId, String(req.orbitUser));
  }
  @Get("suinda-learning/workspaces/:workspaceId/staff-directory") staffDirectory(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string) {
    return this.suinda.staffDirectory(workspaceId, String(req.orbitUser));
  }
  @Post("suinda-learning/workspaces/:workspaceId/me/staff-credentials") uploadStaffCredential(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: Payload,
  ) { return this.suinda.uploadStaffCredential(workspaceId, String(req.orbitUser), body); }
  @Get("suinda-learning/staff-credentials/:id/files/:attachmentId") async staffCredentialFile(
    @Req() req: AccessRequest, @Res() res: Response, @Param("id") recordId: string, @Param("attachmentId") attachmentId: string,
  ) {
    const file = await this.suinda.staffCredentialFile(recordId, attachmentId, String(req.orbitUser));
    res.setHeader("Content-Type", file.mime_type); res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    res.setHeader("Cache-Control", "private, no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.send(file.data);
  }
  @Get("suinda-learning/workspaces/:workspaceId/staff-honoraria") staffHonoraria(@Req() req: AccessRequest, @Param("workspaceId") workspaceId: string) {
    return this.suinda.staffHonoraria(workspaceId, String(req.orbitUser));
  }
  @Post("suinda-learning/workspaces/:workspaceId/staff-honoraria") createStaffHonorarium(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: Payload,
  ) { return this.suinda.createStaffHonorarium(workspaceId, String(req.orbitUser), body); }
  @Post("suinda-learning/workspaces/:workspaceId/staff-honoraria/:honorariumId/payments") createStaffHonorariumPayment(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("honorariumId") honorariumId: string, @Body() body: Payload,
  ) { return this.suinda.createStaffHonorariumPayment(workspaceId, honorariumId, String(req.orbitUser), body); }
  @Post("suinda-learning/courses/:id/duplicate") duplicateCourse(
    @Req() req: AccessRequest, @Param("id") id: string, @Body() body: Payload,
  ) {
    return this.suinda.duplicateCourse(id, String(req.orbitUser), body);
  }
  @Post("suinda-learning/curriculum/:parentKind/:parentId/reorder") reorderCurriculum(
    @Req() req: AccessRequest, @Param("parentKind") parentKind: string, @Param("parentId") parentId: string, @Body() body: Payload,
  ) {
    return this.suinda.reorderCurriculum(parentKind, parentId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/favorites") favorites(@Req() req: AccessRequest) {
    return this.suinda.learnerCourseFavorites(String(req.orbitUser));
  }
  @Post("suinda-learning/me/favorites/:courseId") addFavorite(
    @Req() req: AccessRequest, @Param("courseId") courseId: string, @Body() body: Payload,
  ) {
    return this.suinda.addLearnerCourseFavorite(courseId, String(req.orbitUser), body);
  }
  @Delete("suinda-learning/me/favorites/:courseId") removeFavorite(
    @Req() req: AccessRequest, @Param("courseId") courseId: string, @Body() body: Payload,
  ) {
    return this.suinda.removeLearnerCourseFavorite(courseId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/calendar.ics") async calendar(@Req() req: AccessRequest, @Res() res: Response) {
    const calendar = await this.suinda.learnerCalendar(String(req.orbitUser));
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", "attachment; filename=suinda-minhas-aulas.ics");
    res.send(calendar);
  }
  @Post("suinda-learning/me/calendar-subscription") createCalendarSubscription(@Req() req: AccessRequest) {
    return this.suinda.createLearnerCalendarSubscription(String(req.orbitUser));
  }
  @Get("suinda-learning/me/calendar-subscription") calendarSubscriptionStatus(@Req() req: AccessRequest) {
    return this.suinda.learnerCalendarSubscriptionStatus(String(req.orbitUser));
  }
  @Delete("suinda-learning/me/calendar-subscription") revokeCalendarSubscription(@Req() req: AccessRequest) {
    return this.suinda.revokeLearnerCalendarSubscription(String(req.orbitUser));
  }
  @Get("suinda-learning/me/enrollments/:id/documents") documents(@Req() req: AccessRequest, @Param("id") id: string) {
    return this.suinda.learnerDocuments(id, String(req.orbitUser));
  }
  @Get("suinda-learning/me/enrollments/:id/academic-documents/:termId/attachments/:revision/:attachmentId") async academicDocumentAttachment(
    @Req() req: AccessRequest, @Res() res: Response, @Param("id") id: string, @Param("termId") termId: string,
    @Param("revision") revision: string, @Param("attachmentId") attachmentId: string,
  ) {
    const file = await this.suinda.learnerAcademicDocumentAttachment(id, termId, Number(revision), attachmentId, String(req.orbitUser));
    res.setHeader("Content-Type", file.mime_type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    res.send(file.data);
  }
  @Get("suinda-learning/me/enrollments/:id/signatures") signatures(@Req() req: AccessRequest, @Param("id") id: string) {
    return this.suinda.learnerAcademicSignatures(id, String(req.orbitUser));
  }
  @Post("suinda-learning/me/enrollments/:id/signatures/:termId") signAcademicTerm(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("termId") termId: string, @Body() body: Payload,
  ) {
    return this.suinda.signAcademicTerm(id, termId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/enrollments/:id/surveys") surveys(@Req() req: AccessRequest, @Param("id") id: string) {
    return this.suinda.learnerSurveys(id, String(req.orbitUser));
  }
  @Post("suinda-learning/me/enrollments/:id/surveys/:surveyId/responses") respondToSurvey(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("surveyId") surveyId: string, @Body() body: Payload,
  ) {
    return this.suinda.submitSurveyResponse(id, surveyId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/teaching/surveys/:surveyId/results") surveyResults(@Req() req: AccessRequest, @Param("surveyId") surveyId: string) {
    return this.suinda.surveyResults(surveyId, String(req.orbitUser));
  }
  @Get("suinda-learning/me/teaching/surveys") teachingSurveys(@Req() req: AccessRequest, @Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    return this.suinda.teachingSurveys(String(req.orbitUser), cursor, limit);
  }
  @Post("suinda-learning/me/enrollments/:id/documents") uploadDocument(
    @Req() req: AccessRequest, @Param("id") id: string, @Body() body: Payload,
  ) {
    return this.suinda.uploadLearnerDocument(id, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/enrollments/:id/attendance-justifications") attendanceJustifications(
    @Req() req: AccessRequest, @Param("id") id: string,
  ) {
    return this.suinda.learnerAttendanceJustifications(id, String(req.orbitUser));
  }
  @Post("suinda-learning/me/enrollments/:id/sessions/:sessionId/attendance-justifications") submitAttendanceJustification(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("sessionId") sessionId: string, @Body() body: Payload,
  ) {
    return this.suinda.submitAttendanceJustification(id, sessionId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/sessions/:sessionId/makeup-requests") submitMakeupRequest(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("sessionId") sessionId: string, @Body() body: Payload,
  ) {
    return this.suinda.submitMakeupRequest(id, sessionId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/documents/:documentId/review") reviewDocument(
    @Req() req: AccessRequest, @Param("documentId") documentId: string, @Body() body: Payload,
  ) {
    return this.suinda.reviewLearnerDocument(documentId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/attendance-justifications/:justificationId/review") reviewAttendanceJustification(
    @Req() req: AccessRequest, @Param("justificationId") justificationId: string, @Body() body: Payload,
  ) {
    return this.suinda.reviewAttendanceJustification(justificationId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/teaching") teaching(@Req() req: AccessRequest) {
    return this.suinda.teachingDashboard(String(req.orbitUser));
  }
  @Get("suinda-learning/me/teaching/scholarship-counterparties") teachingScholarshipCounterparties(
    @Req() req: AccessRequest, @Query("cursor") cursor?: string, @Query("limit") limit?: string,
  ) {
    return this.suinda.teachingScholarshipCounterparties(String(req.orbitUser), cursor, limit);
  }
  @Get("suinda-learning/me/teaching/scholarship-applications") teachingScholarshipApplications(
    @Req() req: AccessRequest, @Query("cursor") cursor?: string, @Query("limit") limit?: string,
  ) {
    return this.suinda.teachingScholarshipApplications(String(req.orbitUser), cursor, limit);
  }
  @Get("suinda-learning/me/teaching/financial-action-queue") teachingFinancialActionQueue(
    @Req() req: AccessRequest, @Query("queue") queue?: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string,
  ) {
    if (queue !== "payment" && queue !== "refund" && queue !== "cancellation") throw new BadRequestException("Fila financeira inválida.");
    return this.suinda.teachingFinancialActionQueue(String(req.orbitUser), queue, cursor, limit);
  }
  @Get("suinda-learning/me/teaching/unit-operations/:queue") teachingUnitOperations(
    @Req() req: AccessRequest, @Param("queue") queue: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string,
  ) {
    return this.suinda.teachingUnitOperations(String(req.orbitUser), queue, cursor, limit);
  }
  @Get("suinda-learning/me/teaching/admin/assessment-risks") teachingAdminAssessmentRisks(
    @Req() req: AccessRequest, @Query("cursor") cursor?: string, @Query("limit") limit?: string,
  ) {
    return this.suinda.teachingAdminAssessmentRisks(String(req.orbitUser), cursor, limit);
  }
  @Get("suinda-learning/me/teaching/admin/operations") teachingAdminOperations(
    @Req() req: AccessRequest, @Query("queue") queue: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string,
  ) {
    return this.suinda.teachingAdminOperations(String(req.orbitUser), queue, cursor, limit);
  }
  @Get("suinda-learning/me/teaching/accessibility-audit/courses") teachingAccessibilityAuditCourses(
    @Req() req: AccessRequest, @Query("cursor") cursor?: string, @Query("limit") limit?: string,
  ) {
    return this.suinda.teachingAccessibilityAuditCourses(String(req.orbitUser), cursor, limit);
  }
  @Get("suinda-learning/me/teaching/accessibility-audit/courses/:courseId/lessons") teachingAccessibilityAuditLessons(
    @Req() req: AccessRequest, @Param("courseId") courseId: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string,
  ) {
    return this.suinda.teachingAccessibilityAuditLessons(String(req.orbitUser), courseId, cursor, limit);
  }
  @Get("suinda-learning/me/reports") academicReports(@Req() req: AccessRequest, @Query("from") from?: string, @Query("to") to?: string, @Query("unit_id") unitId?: string) {
    return this.suinda.academicReports(String(req.orbitUser), from, to, unitId);
  }
  @Get("suinda-learning/me/finance-ledger.csv") async financialLedgerCsv(
    @Req() req: AccessRequest, @Res() res: Response, @Query("from") from?: string, @Query("to") to?: string, @Query("unit_id") unitId?: string,
  ) {
    const file = await this.suinda.financialLedgerCsv(String(req.orbitUser), from, to, unitId);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(file.csv);
  }
  @Get("suinda-learning/workspaces/:workspaceId/units/:unitId/team") institutionUnitTeam(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("unitId") unitId: string,
  ) {
    return this.suinda.institutionUnitTeam(String(req.orbitUser), workspaceId, unitId);
  }
  @Post("suinda-learning/workspaces/:workspaceId/units/:unitId/team") setInstitutionUnitMember(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("unitId") unitId: string, @Body() body: Payload,
  ) {
    return this.suinda.setInstitutionUnitMember(String(req.orbitUser), workspaceId, unitId, body);
  }
  @Delete("suinda-learning/workspaces/:workspaceId/units/:unitId/team/:userId") removeInstitutionUnitMember(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("unitId") unitId: string, @Param("userId") userId: string,
  ) {
    return this.suinda.removeInstitutionUnitMember(String(req.orbitUser), workspaceId, unitId, userId);
  }
  @Get("suinda-learning/me/reports.pdf") async academicReportsPdf(
    @Req() req: AccessRequest, @Res() res: Response, @Query("from") from?: string, @Query("to") to?: string, @Query("unit_id") unitId?: string,
  ) {
    const report = await this.suinda.academicReports(String(req.orbitUser), from, to, unitId);
    const pdf = await createAcademicReportPdf(report);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="suinda-relatorios-${report.range.from}-${report.range.to}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(pdf);
  }
  @Get("suinda-learning/me/teaching/lessons/:lessonId/materials") lessonMaterials(@Req() req: AccessRequest, @Param("lessonId") lessonId: string) {
    return this.suinda.listLessonMaterials(lessonId, String(req.orbitUser));
  }
  @Post("suinda-learning/me/teaching/lessons/:lessonId/materials") uploadLessonMaterial(
    @Req() req: AccessRequest, @Param("lessonId") lessonId: string, @Body() body: Payload,
  ) {
    return this.suinda.uploadLessonMaterial(lessonId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/lessons/:lessonId/materials/:attachmentId/alt-text") updateLessonMaterialAltText(
    @Req() req: AccessRequest, @Param("lessonId") lessonId: string, @Param("attachmentId") attachmentId: string, @Body() body: Payload,
  ) {
    return this.suinda.updateLessonMaterialAltText(lessonId, attachmentId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/lessons/:lessonId/accessibility") remediatePublishedLessonAccessibility(
    @Req() req: AccessRequest, @Param("lessonId") lessonId: string, @Body() body: Payload,
  ) {
    return this.suinda.remediatePublishedLessonAccessibility(lessonId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/sessions/:sessionId/attendance") markAttendance(
    @Req() req: AccessRequest, @Param("sessionId") sessionId: string, @Body() body: Payload,
  ) {
    return this.suinda.markTeachingAttendance(sessionId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/sessions/:sessionId/attendance/zoom-sync") syncZoomAttendance(
    @Req() req: AccessRequest, @Param("sessionId") sessionId: string, @Body() body: Payload,
  ) {
    return this.suinda.syncZoomAttendance(sessionId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/sessions/:sessionId/attendance/:provider-sync") syncRemoteAttendance(
    @Req() req: AccessRequest, @Param("sessionId") sessionId: string, @Param("provider") provider: string, @Body() body: Payload,
  ) {
    if (provider !== "google-meet" && provider !== "teams") throw new BadRequestException("Provedor de presença inválido.");
    return this.suinda.syncRemoteAttendance(sessionId, provider === "google-meet" ? "google_meet" : "teams", String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/sessions/:sessionId/meeting-room") createSessionMeeting(
    @Req() req: AccessRequest, @Param("sessionId") sessionId: string, @Body() body: Payload,
  ) {
    return this.suinda.createSessionMeeting(sessionId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/sessions/:sessionId/meeting-room/reconcile") reconcileSessionZoomMeeting(
    @Req() req: AccessRequest, @Param("sessionId") sessionId: string, @Body() body: Payload,
  ) {
    return this.suinda.reconcileSessionZoomMeeting(sessionId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/teaching/sessions/:sessionId/checkin-code") sessionCheckinCode(
    @Req() req: AccessRequest, @Param("sessionId") sessionId: string,
  ) {
    return this.suinda.createSessionCheckinCode(sessionId, String(req.orbitUser));
  }
  @Post("suinda-learning/me/checkin") checkinByQr(@Req() req: AccessRequest, @Body() body: Payload) {
    return this.suinda.checkinByQr(String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/submissions/:submissionId/grade") gradeSubmission(
    @Req() req: AccessRequest, @Param("submissionId") submissionId: string, @Body() body: Payload,
  ) {
    return this.suinda.gradeTeachingSubmission(submissionId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/assessment-attempts/:attemptId/grade") gradeAssessmentAttempt(
    @Req() req: AccessRequest, @Param("attemptId") attemptId: string, @Body() body: Payload,
  ) {
    return this.suinda.gradeAssessmentAttempt(attemptId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/practices/:practiceId/review") reviewPractice(
    @Req() req: AccessRequest, @Param("practiceId") practiceId: string, @Body() body: Payload,
  ) {
    return this.suinda.reviewSupervisedPractice(practiceId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/practices/:practiceId/submit") submitPractice(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("practiceId") practiceId: string, @Body() body: Payload,
  ) {
    return this.suinda.submitSupervisedPractice(id, practiceId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/actions") updateOwnEnrollment(
    @Req() req: AccessRequest, @Param("id") id: string, @Body() body: Payload,
  ) {
    return this.suinda.updateOwnEnrollment(id, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/submit") submitOwnEnrollment(
    @Req() req: AccessRequest, @Param("id") id: string, @Body() body: Payload,
  ) {
    return this.suinda.submitOwnEnrollment(id, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/coupon") updateOwnEnrollmentCoupon(
    @Req() req: AccessRequest, @Param("id") id: string, @Body() body: Payload,
  ) {
    return this.suinda.updateOwnEnrollmentCoupon(id, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/scholarships") scholarshipPrograms(@Req() req: AccessRequest, @Query("courseId") courseId: string) {
    return this.suinda.listScholarshipPrograms(String(req.orbitUser), courseId);
  }
  @Post("suinda-learning/me/enrollments/:id/scholarship-applications") createScholarshipApplication(
    @Req() req: AccessRequest, @Param("id") id: string, @Body() body: Payload,
  ) {
    return this.suinda.createScholarshipApplication(id, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/scholarship-applications/:applicationId/review") reviewScholarshipApplication(
    @Req() req: AccessRequest, @Param("applicationId") applicationId: string, @Body() body: Payload,
  ) {
    return this.suinda.reviewScholarshipApplication(applicationId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/scholarship-counterparties") learnerScholarshipCounterparties(@Req() req: AccessRequest) {
    return this.suinda.learnerScholarshipCounterparties(String(req.orbitUser));
  }
  @Post("suinda-learning/me/scholarship-counterparties/:counterpartyId/submission") submitScholarshipCounterparty(
    @Req() req: AccessRequest, @Param("counterpartyId") counterpartyId: string, @Body() body: Payload,
  ) {
    return this.suinda.submitScholarshipCounterparty(counterpartyId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/scholarship-counterparties/:counterpartyId/review") reviewScholarshipCounterparty(
    @Req() req: AccessRequest, @Param("counterpartyId") counterpartyId: string, @Body() body: Payload,
  ) {
    return this.suinda.reviewScholarshipCounterparty(counterpartyId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/scholarship-counterparties/:id/files/:attachmentId") async scholarshipCounterpartyFile(
    @Req() req: AccessRequest, @Res() res: Response, @Param("id") id: string, @Param("attachmentId") attachmentId: string,
    @Query("revision") revision: string,
  ) {
    const file = await this.suinda.scholarshipCounterpartyFile(id, attachmentId, Number(revision), String(req.orbitUser));
    res.setHeader("Content-Type", file.mime_type);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(file.data);
  }
  @Post("suinda-learning/me/teaching/enrollments/:enrollmentId/payments") recordEnrollmentPayment(
    @Req() req: AccessRequest, @Param("enrollmentId") enrollmentId: string, @Body() body: Payload,
  ) {
    return this.suinda.recordEnrollmentPayment(enrollmentId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:enrollmentId/checkout") createEnrollmentCheckout(
    @Req() req: AccessRequest, @Param("enrollmentId") enrollmentId: string, @Body() body: Payload,
  ) {
    return this.suinda.createEnrollmentCheckout(enrollmentId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/enrollments/:enrollmentId/checkout") enrollmentCheckoutStatus(
    @Req() req: AccessRequest, @Param("enrollmentId") enrollmentId: string,
  ) {
    return this.suinda.enrollmentCheckoutStatus(enrollmentId, String(req.orbitUser));
  }
  @Get("suinda-learning/workspaces/:workspaceId/payment-provider") paymentProviderSettings(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string,
  ) {
    return this.suinda.paymentProviderSettings(workspaceId, String(req.orbitUser));
  }
  @Put("suinda-learning/workspaces/:workspaceId/payment-provider") savePaymentProviderSettings(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Body() body: Payload,
  ) {
    return this.suinda.savePaymentProviderSettings(workspaceId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/workspaces/:workspaceId/payment-reviews") paymentReviewQueue(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string,
  ) {
    return this.suinda.paymentReviewQueue(workspaceId, String(req.orbitUser));
  }
  @Post("suinda-learning/workspaces/:workspaceId/payment-reviews/:checkoutId/reconcile") reconcileMercadoPagoCheckout(
    @Req() req: AccessRequest, @Param("workspaceId") workspaceId: string, @Param("checkoutId") checkoutId: string, @Body() body: Payload,
  ) {
    return this.suinda.reconcileMercadoPagoCheckout(workspaceId, checkoutId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/makeup-requests/:requestId/fee") recordMakeupFee(
    @Req() req: AccessRequest, @Param("requestId") requestId: string, @Body() body: Payload,
  ) {
    return this.suinda.recordMakeupFee(requestId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/enrollments/:enrollmentId/refunds") recordEnrollmentRefund(
    @Req() req: AccessRequest, @Param("enrollmentId") enrollmentId: string, @Body() body: Payload,
  ) {
    return this.suinda.recordEnrollmentRefund(enrollmentId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/enrollments/:enrollmentId/financial-cancellations") recordEnrollmentFinancialCancellation(
    @Req() req: AccessRequest, @Param("enrollmentId") enrollmentId: string, @Body() body: Payload,
  ) {
    return this.suinda.recordEnrollmentFinancialCancellation(enrollmentId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/enrollments/:enrollmentId/transfer") transferEnrollment(
    @Req() req: AccessRequest, @Param("enrollmentId") enrollmentId: string, @Body() body: Payload,
  ) {
    return this.suinda.transferEnrollment(enrollmentId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/cohorts/:cohortId/import/preview") previewEnrollmentImport(
    @Req() req: AccessRequest, @Param("cohortId") cohortId: string, @Body() body: Payload,
  ) {
    return this.suinda.previewEnrollmentCsv(cohortId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/cohorts/:cohortId/import") importEnrollmentCsv(
    @Req() req: AccessRequest, @Param("cohortId") cohortId: string, @Body() body: Payload,
  ) {
    return this.suinda.importEnrollmentCsv(cohortId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/teaching/cohorts/:cohortId/announcements") sendTeachingAnnouncement(
    @Req() req: AccessRequest, @Param("cohortId") cohortId: string, @Body() body: Payload,
  ) {
    return this.suinda.sendTeachingAnnouncement(cohortId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/teaching/cohorts/:cohortId/announcement-templates") teachingAnnouncementTemplates(
    @Req() req: AccessRequest, @Param("cohortId") cohortId: string,
  ) {
    return this.suinda.teachingAnnouncementTemplates(cohortId, String(req.orbitUser));
  }
  @Get("suinda-learning/me/enrollments/:id/learning") learning(@Req() req: AccessRequest, @Param("id") id: string) {
    return this.suinda.learnerLearning(id, String(req.orbitUser));
  }
  @Get("suinda-learning/me/enrollments/:id/lessons/:lessonId/materials/:attachmentId/preview") async previewLessonMaterial(
    @Req() req: AccessRequest, @Res() res: Response, @Param("id") id: string, @Param("lessonId") lessonId: string, @Param("attachmentId") attachmentId: string,
  ) {
    const file = await this.suinda.learnerLessonMaterialPreview(id, lessonId, attachmentId, String(req.orbitUser));
    res.setHeader("Content-Type", file.mime_type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    res.send(file.data);
  }
  @Post("suinda-learning/me/enrollments/:id/lessons/:lessonId/complete") completeLesson(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("lessonId") lessonId: string, @Body() body: Payload,
  ) {
    return this.suinda.completeLesson(id, lessonId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/lessons/:lessonId/media-progress") saveMediaProgress(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("lessonId") lessonId: string, @Body() body: Payload,
  ) {
    return this.suinda.saveMediaProgress(id, lessonId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/lessons/:lessonId/bookmark") bookmarkLesson(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("lessonId") lessonId: string, @Body() body: Payload,
  ) {
    return this.suinda.saveLearningBookmark(id, lessonId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/enrollments/:id/community") community(
    @Req() req: AccessRequest, @Param("id") id: string, @Query("lesson") lessonId?: string,
  ) {
    return this.suinda.learnerCommunity(id, String(req.orbitUser), lessonId);
  }
  @Post("suinda-learning/me/enrollments/:id/community") createCommunityThread(
    @Req() req: AccessRequest, @Param("id") id: string, @Body() body: Payload,
  ) {
    return this.suinda.createCommunityThread(id, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/community/threads/:threadId/replies") replyCommunityThread(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("threadId") threadId: string, @Body() body: Payload,
  ) {
    return this.suinda.replyCommunityThread(id, threadId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/community/threads/:threadId/reactions") reactCommunityThread(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("threadId") threadId: string, @Body() body: Payload,
  ) {
    return this.suinda.reactCommunityThread(id, threadId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/community/threads/:threadId/pin") pinCommunityThread(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("threadId") threadId: string, @Body() body: Payload,
  ) {
    return this.suinda.setCommunityThreadPinned(threadId, String(req.orbitUser), true, body);
  }
  @Post("suinda-learning/me/enrollments/:id/community/threads/:threadId/unpin") unpinCommunityThread(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("threadId") threadId: string, @Body() body: Payload,
  ) {
    return this.suinda.setCommunityThreadPinned(threadId, String(req.orbitUser), false, body);
  }
  @Get("suinda-learning/me/teaching/courses/:courseId/community") teachingCommunityThreads(@Req() req: AccessRequest, @Param("courseId") courseId: string) {
    return this.suinda.teachingCommunityThreads(courseId, String(req.orbitUser));
  }
  @Post("suinda-learning/me/teaching/community/threads/:threadId/:action") setTeachingCommunityThreadPinned(
    @Req() req: AccessRequest, @Param("threadId") threadId: string, @Param("action") action: string, @Body() body: Payload,
  ) {
    if (action !== "pin" && action !== "unpin") throw new BadRequestException("Ação de pinagem inválida.");
    return this.suinda.setCommunityThreadPinned(threadId, String(req.orbitUser), action === "pin", body);
  }
  @Post("suinda-learning/me/enrollments/:id/community/reports") reportCommunityContent(
    @Req() req: AccessRequest, @Param("id") id: string, @Body() body: Payload,
  ) {
    return this.suinda.reportCommunityContent(id, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/enrollments/:id/community/participants") communityParticipants(@Req() req: AccessRequest, @Param("id") id: string) {
    return this.suinda.communityParticipants(id, String(req.orbitUser));
  }
  @Get("suinda-learning/me/enrollments/:id/community/connections") communityConnections(@Req() req: AccessRequest, @Param("id") id: string) {
    return this.suinda.communityConnections(id, String(req.orbitUser));
  }
  @Post("suinda-learning/me/enrollments/:id/community/connections") requestCommunityConnection(
    @Req() req: AccessRequest, @Param("id") id: string, @Body() body: Payload,
  ) {
    return this.suinda.requestCommunityConnection(id, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/community/connections/:connectionId/:action") respondCommunityConnection(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("connectionId") connectionId: string, @Param("action") action: string, @Body() body: Payload,
  ) {
    if (!["accept", "decline", "cancel"].includes(action)) throw new BadRequestException("Ação de conexão inválida.");
    return this.suinda.respondToCommunityConnection(id, connectionId, String(req.orbitUser), action as "accept" | "decline" | "cancel", body);
  }
  @Get("suinda-learning/me/enrollments/:id/community/connections/:connectionId/messages") communityDirectMessages(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("connectionId") connectionId: string,
  ) {
    return this.suinda.communityDirectMessages(id, connectionId, String(req.orbitUser));
  }
  @Post("suinda-learning/me/enrollments/:id/community/connections/:connectionId/messages") sendCommunityDirectMessage(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("connectionId") connectionId: string, @Body() body: Payload,
  ) {
    return this.suinda.sendCommunityDirectMessage(id, connectionId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/teaching/community-reports") teachingCommunityReports(@Req() req: AccessRequest) {
    return this.suinda.teachingCommunityReports(String(req.orbitUser));
  }
  @Post("suinda-learning/me/teaching/community-reports/:reportId/:action") resolveTeachingCommunityReport(
    @Req() req: AccessRequest, @Param("reportId") reportId: string, @Param("action") action: string, @Body() body: Payload,
  ) {
    if (action !== "dismiss" && action !== "remove") throw new BadRequestException("Ação de moderação inválida.");
    return this.suinda.resolveTeachingCommunityReport(String(req.orbitUser), reportId, action, body);
  }
  @Get("suinda-learning/me/enrollments/:id/community/groups") studyGroups(@Req() req: AccessRequest, @Param("id") id: string) {
    return this.suinda.learnerStudyGroups(id, String(req.orbitUser));
  }
  @Post("suinda-learning/me/enrollments/:id/community/groups") createStudyGroup(
    @Req() req: AccessRequest, @Param("id") id: string, @Body() body: Payload,
  ) {
    return this.suinda.createStudyGroup(id, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/community/groups/:groupId/join") joinStudyGroup(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("groupId") groupId: string, @Body() body: Payload,
  ) {
    return this.suinda.joinStudyGroup(id, groupId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/community/groups/:groupId/leave") leaveStudyGroup(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("groupId") groupId: string, @Body() body: Payload,
  ) {
    return this.suinda.leaveStudyGroup(id, groupId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/community/groups/:groupId/close") closeStudyGroup(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("groupId") groupId: string, @Body() body: Payload,
  ) {
    return this.suinda.closeStudyGroup(id, groupId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/enrollments/:id/community/groups/:groupId/messages") studyGroupMessages(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("groupId") groupId: string, @Query("before") before?: string,
  ) {
    return this.suinda.studyGroupMessages(id, groupId, String(req.orbitUser), before);
  }
  @Post("suinda-learning/me/enrollments/:id/community/groups/:groupId/messages") sendStudyGroupMessage(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("groupId") groupId: string, @Body() body: Payload,
  ) {
    return this.suinda.sendStudyGroupMessage(id, groupId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/enrollments/:id/messages") learningMessages(@Req() req: AccessRequest, @Param("id") id: string) {
    return this.suinda.learningMessages(id, String(req.orbitUser));
  }
  @Post("suinda-learning/me/enrollments/:id/messages") sendLearningMessage(
    @Req() req: AccessRequest, @Param("id") id: string, @Body() body: Payload,
  ) {
    return this.suinda.sendLearningMessage(id, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/enrollments/:id/assessments") assessments(@Req() req: AccessRequest, @Param("id") id: string) {
    return this.suinda.learnerAssessments(id, String(req.orbitUser));
  }
  @Post("suinda-learning/me/enrollments/:id/assessments/:assessmentId/sessions") startAssessment(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("assessmentId") assessmentId: string, @Body() body: Payload,
  ) {
    return this.suinda.startAssessment(id, assessmentId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/assessments/:assessmentId/attempts") submitAssessment(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("assessmentId") assessmentId: string, @Body() body: Payload,
  ) {
    return this.suinda.submitAssessment(id, assessmentId, String(req.orbitUser), body);
  }
  @Post("suinda-learning/me/enrollments/:id/assessments/:assessmentId/submissions") submitAssignment(
    @Req() req: AccessRequest, @Param("id") id: string, @Param("assessmentId") assessmentId: string, @Body() body: Payload,
  ) {
    return this.suinda.submitLearningAssignment(id, assessmentId, String(req.orbitUser), body);
  }
  @Get("suinda-learning/me/certificates/:id/pdf") async downloadCertificate(
    @Req() req: AccessRequest, @Res() res: Response, @Param("id") id: string,
  ) {
    const file = await this.suinda.downloadCertificate(id, String(req.orbitUser));
    const signed = await this.certificateSigning.signPdf(file.workspace_id, file.data);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Suinda-Certificate-Pdf-Signed", signed.signed ? "true" : "false");
    if (signed.signed) res.setHeader("X-Suinda-Certificate-Pdf-SubFilter", signed.sub_filter);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    res.send(signed.data);
  }
}

@Controller("public/suinda")
export class SuindaPublicController {
  constructor(@Inject(SuindaLearningService) private readonly suinda: SuindaLearningService) {}

  @Get("courses") courses() {
    this.suinda.assertAvailable();
    return this.suinda.publicCourses();
  }
  @Post("payments/mercado-pago/webhook") mercadoPagoWebhook(
    @Req() req: Request, @Query("workspace") workspace: string, @Query("data.id") paymentId: string,
    @Query("type") type: string, @Body() body: Record<string, unknown>,
  ) {
    const signature = req.headers["x-signature"];
    const requestId = req.headers["x-request-id"];
    return this.suinda.handleMercadoPagoWebhook(String(workspace || ""), String(paymentId || ""),
      String(type || ""), String(Array.isArray(signature) ? signature[0] : signature || ""),
      String(Array.isArray(requestId) ? requestId[0] : requestId || ""), body);
  }
  @Get("courses/:id") course(@Param("id") id: string) {
    this.suinda.assertAvailable();
    return this.suinda.publicCourse(id);
  }
  @Get("courses/:id/cohorts") cohorts(@Param("id") id: string) {
    this.suinda.assertAvailable();
    return this.suinda.publicCourseCohorts(id);
  }
  @Get("certificates/:code") certificate(@Param("code") code: string) {
    return this.suinda.publicCertificate(code);
  }
  @Get("calendar/:token.ics") async calendarSubscription(@Param("token") token: string, @Res() res: Response) {
    const calendar = await this.suinda.learnerCalendarBySubscription(token);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Content-Disposition", "inline; filename=suinda-agenda.ics");
    res.send(calendar);
  }
}
