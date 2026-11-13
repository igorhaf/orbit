import 'dotenv/config';
import { Pool } from 'pg';

type DemoRecord = {
  id: string;
  kind: string;
  title: string;
  state: string;
  payload: Record<string, unknown>;
};

const ids = {
  unit: 'd1000000-0000-4000-8000-000000000001',
  inclusion: 'd1000000-0000-4000-8000-000000000101',
  community: 'd1000000-0000-4000-8000-000000000102',
  digital: 'd1000000-0000-4000-8000-000000000103',
  path: 'd1000000-0000-4000-8000-000000000201',
} as const;

const courses = [
  {
    id: ids.inclusion, code: 'DEMO-INCLUSAO', title: 'Educação inclusiva na prática',
    summary: 'Planejamento acessível, participação e acompanhamento da aprendizagem.',
    description: 'Formação demonstrativa sobre desenho de atividades acessíveis, comunicação inclusiva e acompanhamento de diferentes trajetórias de aprendizagem.',
    category: 'Educação e inclusão', tags: ['acessibilidade', 'educação', 'práticas inclusivas'],
    objectives: ['Planejar atividades acessíveis', 'Identificar barreiras à participação', 'Acompanhar a aprendizagem com diferentes evidências'],
    skills: ['Desenho universal para aprendizagem', 'Comunicação acessível', 'Avaliação formativa'], workload: 12,
    moduleId: 'd1000000-0000-4000-8000-000000000301', unitId: 'd1000000-0000-4000-8000-000000000401',
    lessonIds: ['d1000000-0000-4000-8000-000000000501', 'd1000000-0000-4000-8000-000000000502'],
    cohortId: 'd1000000-0000-4000-8000-000000000601',
  },
  {
    id: ids.community, code: 'DEMO-COMUNIDADE', title: 'Gestão de projetos comunitários',
    summary: 'Da escuta do território à avaliação de iniciativas locais.',
    description: 'Formação demonstrativa para organizar projetos comunitários com participação local, objetivos claros, cronograma, parcerias e avaliação de resultados.',
    category: 'Gestão e comunidade', tags: ['projetos', 'território', 'participação'],
    objectives: ['Mapear necessidades do território', 'Construir um plano de ação colaborativo', 'Acompanhar resultados e aprendizados'],
    skills: ['Facilitação', 'Planejamento', 'Monitoramento participativo'], workload: 16,
    moduleId: 'd1000000-0000-4000-8000-000000000302', unitId: 'd1000000-0000-4000-8000-000000000402',
    lessonIds: ['d1000000-0000-4000-8000-000000000503', 'd1000000-0000-4000-8000-000000000504'],
    cohortId: 'd1000000-0000-4000-8000-000000000602',
  },
  {
    id: ids.digital, code: 'DEMO-CULTURADIGITAL', title: 'Cultura digital e produção audiovisual',
    summary: 'Criação responsável de conteúdos para aprendizagem e comunicação.',
    description: 'Formação demonstrativa em linguagem audiovisual, roteiro, produção com recursos acessíveis e publicação responsável de conteúdos digitais.',
    category: 'Tecnologia e comunicação', tags: ['cultura digital', 'audiovisual', 'comunicação'],
    objectives: ['Elaborar um roteiro objetivo', 'Produzir conteúdo audiovisual acessível', 'Publicar materiais com contexto e créditos'],
    skills: ['Roteirização', 'Produção audiovisual', 'Acessibilidade digital'], workload: 14,
    moduleId: 'd1000000-0000-4000-8000-000000000303', unitId: 'd1000000-0000-4000-8000-000000000403',
    lessonIds: ['d1000000-0000-4000-8000-000000000505', 'd1000000-0000-4000-8000-000000000506'],
    cohortId: 'd1000000-0000-4000-8000-000000000603',
  },
] as const;

function records(): DemoRecord[] {
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() + 14);
  const end = new Date(start); end.setDate(end.getDate() + 70);
  const iso = (date: Date) => date.toISOString();
  const rows: DemoRecord[] = [{
    id: ids.unit, kind: 'institution_unit', title: 'DEMO | Núcleo de formação Suindá', state: 'published',
    payload: { unit_code: 'DEMO-SUINDA', unit_type: 'center', city: 'Recife', state_code: 'PE', address: null, contact_email: null, contact_phone: null },
  }];
  for (const course of courses) {
    rows.push({
      id: course.id, kind: 'course', title: `DEMO | ${course.title}`, state: 'published',
      payload: {
        institution_unit_record_id: ids.unit, code: course.code, summary: course.summary, description: course.description,
        category: course.category, tags: course.tags, modality: 'online', format: 'cohort', level: 'introductory',
        workload_mode: 'manual', workload_hours: course.workload, attendance_min_percent: 75, certificate_min_grade: 70,
        attendance_justification_deadline_days: 7, required_document_categories: [], objectives: course.objectives,
        competencies: course.skills, skills: course.skills, prerequisites: [], prerequisite_course_ids: [], required_materials: [],
        instructor_ids: [], intermediate_certificate_milestones: [], makeup_fee_amount: 0, application_form_fields: [],
        image_url: null, price_amount: 0, currency: 'BRL', installment_count: 1, first_payment_due_days: 0,
        installment_interval_days: 30, capacity: 30, version: 1, enrollment_opens_at: iso(now), enrollment_closes_at: iso(end),
        starts_on: start.toISOString().slice(0, 10), ends_on: end.toISOString().slice(0, 10), enrollment_confirmation_hours: 72,
      },
    });
    rows.push({
      id: course.moduleId, kind: 'module', title: `DEMO | ${course.title}: fundamentos`, state: 'published',
      payload: { course_record_id: course.id, course_revision: 1, course_version: 1, position: 1, summary: course.summary,
        objectives: course.objectives, competencies: course.skills, skills: course.skills, prerequisite_module_ids: [], workload_hours: course.workload, sequential: false },
    }, {
      id: course.unitId, kind: 'learning_unit', title: `DEMO | ${course.title}: unidade introdutória`, state: 'published',
      payload: { module_record_id: course.moduleId, position: 1, summary: course.summary, objectives: course.objectives, competencies: course.skills, skills: course.skills },
    });
    for (let index = 0; index < 2; index++) rows.push({
      id: course.lessonIds[index], kind: 'lesson', title: `DEMO | ${course.title}: ${index === 0 ? 'conceitos e contexto' : 'atividade aplicada'}`, state: 'published',
      payload: { module_record_id: course.moduleId, unit_record_id: course.unitId, position: index + 1, content_type: 'article',
        content_url: null, body_markdown: index === 0
          ? `## ${course.title}\n\n${course.description}\n\n**Objetivo:** ${course.objectives[0]}.\n\nEste material é fictício e serve para demonstração da plataforma Suindá.`
          : `## Atividade aplicada\n\n${course.objectives[1]}.\n\nRegistre uma reflexão ou plano de ação relacionado ao seu contexto de aprendizagem.\n\nEste exercício é demonstrativo.`,
        transcript: null, transcript_reviewed: false, document_accessibility_reviewed: false,
        workload_minutes: index === 0 ? 35 : 45, captions_reviewed: false, required: true, downloadable: false,
        release_at: iso(now), prerequisites: [], objectives: course.objectives, competencies: course.skills, skills: course.skills },
    });
    rows.push({
      id: course.cohortId, kind: 'cohort', title: `DEMO | Turma aberta — ${course.title}`, state: 'enrolling',
      payload: { institution_unit_record_id: ids.unit, course_record_id: course.id, course_revision: 1,
        code: `${course.code}-T1`, instructor_ids: [], tutor_ids: [], preceptor_ids: [], coordinator_ids: [], price_amount: 0,
        enrollment_opens_at: iso(now), enrollment_closes_at: iso(end), starts_at: iso(start), ends_at: iso(end),
        capacity: 30, location: 'Ambiente virtual Suindá', meeting_url: null, schedule: ['Atividades assíncronas e encontros virtuais demonstrativos'], required_document_categories: [] },
    });
  }
  rows.push({
    id: ids.path, kind: 'learning_path', title: 'DEMO | Trilha de aprendizagem e atuação comunitária', state: 'published',
    payload: { description: 'Trilha demonstrativa que reúne educação inclusiva, organização comunitária e comunicação digital para apoiar iniciativas de aprendizagem com impacto local.',
      course_record_ids: courses.map((course) => course.id), target_competencies: ['Planejamento inclusivo', 'Colaboração comunitária', 'Comunicação digital responsável'], required_for_profiles: [] },
  });
  return rows;
}

async function main() {
  if (process.env.ORBIT_PRODUCT !== 'suinda') throw new Error('A carga demonstrativa só pode ser executada com ORBIT_PRODUCT=suinda.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const workspace = await client.query<{ id: string; owner_id: string }>(
        `SELECT w.id, w.owner_id FROM workspaces w JOIN users u ON u.id=w.owner_id
         WHERE u.is_root=true AND w.archived_at IS NULL ORDER BY w.created_at LIMIT 1 FOR UPDATE OF w`,
      );
      if (!workspace.rows[0]) throw new Error('O workspace principal do Suindá não foi encontrado.');
      const { id: workspaceId, owner_id: actorId } = workspace.rows[0];
      let inserted = 0;
      for (const record of records()) {
        const result = await client.query(
          `INSERT INTO extension_records(id,workspace_id,plugin_id,kind,title,state,revision,payload,created_by,updated_by)
           VALUES($1,$2,'suinda-learning',$3,$4,$5,1,$6::jsonb,$7,$7)
           ON CONFLICT(id) DO NOTHING`,
          [record.id, workspaceId, record.kind, record.title, record.state, JSON.stringify(record.payload), actorId],
        );
        if (result.rowCount) {
          await client.query(
            `INSERT INTO extension_record_versions(record_id,revision,title,state,payload,reason,actor_id)
             VALUES($1,1,$2,$3,$4::jsonb,'Carga inicial de dados demonstrativos do Suindá',$5)`,
            [record.id, record.title, record.state, JSON.stringify(record.payload), actorId],
          );
          inserted++;
        }
      }
      await client.query('COMMIT');
      console.log(`Dados demonstrativos do Suindá prontos: ${inserted} registros novos; ${records().length - inserted} já existiam.`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
