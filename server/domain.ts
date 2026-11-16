import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { Answers, Question } from '../shared/types.ts';
export const questionSchema = z
  .object({
    type: z.enum(['single', 'multiple', 'boolean', 'text', 'scale']),
    category: z.string().trim().min(1).max(40),
    prompt: z.string().trim().min(3).max(1500),
    options: z.array(z.string().trim().min(1).max(300)).max(8),
    correct: z.array(z.number().int().min(0).max(7)).max(8),
    points: z.number().int().min(0).max(100),
    explanation: z.string().max(2000),
    active: z.boolean()
  })
  .superRefine((q, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (q.type === 'text' || q.type === 'scale') {
      if (q.points !== 0 || q.correct.length || q.options.length) fail('简答与量表必须不计分，且无选项或标准答案');
    } else {
      if (q.options.length < 2 || new Set(q.options).size !== q.options.length) fail('至少两个不重复的选项');
      if (
        !q.correct.length ||
        new Set(q.correct).size !== q.correct.length ||
        q.correct.some(i => i >= q.options.length)
      )
        fail('标准答案无效');
      if (q.type !== 'multiple' && q.correct.length !== 1) fail('单选和判断题必须只有一个正确答案');
      if (q.type === 'boolean' && q.options.length !== 2) fail('判断题必须有两个选项');
      if (q.points < 1) fail('客观题分值必须大于零');
    }
  });
export const answersSchema = z.record(
  z.string(),
  z.union([z.array(z.number().int()).max(8), z.string().max(2000), z.number().int()])
);
export function validateAnswers(questions: Question[], answers: Answers, complete = true) {
  if (Object.keys(answers).some(id => !questions.some(q => q.id === id))) throw new Error('包含未抽取的题目');
  for (const q of questions) {
    const value = answers[q.id];
    if (value === undefined && !complete) continue;
    if (q.type === 'text') {
      if (value !== undefined && typeof value !== 'string') throw new Error('简答格式不正确');
    } else if (q.type === 'scale') {
      if (value !== undefined && (typeof value !== 'number' || value < 1 || value > 5))
        throw new Error('量表范围是 1–5');
    } else {
      if (
        !Array.isArray(value) ||
        !value.length ||
        new Set(value).size !== value.length ||
        value.some(i => i < 0 || i >= q.options.length) ||
        (q.type !== 'multiple' && value.length !== 1)
      ) {
        throw new Error(complete ? '请完成所有计分题，且提交有效选项' : '选项格式不正确');
      }
    }
  }
}
export function grade(questions: Question[], answers: Answers) {
  validateAnswers(questions, answers);
  let earned = 0,
    total = 0;
  for (const q of questions) {
    total += q.points;
    if (q.points && Array.isArray(answers[q.id])) {
      const a = answers[q.id] as number[];
      if (a.length === q.correct.length && a.every(i => q.correct.includes(i))) earned += q.points;
    }
  }
  if (!total) throw new Error('问卷必须包含计分题');
  return { earned, total, score: Math.round((earned / total) * 10000) / 100 };
}
function shuffle<T>(items: T[]) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function drawQuestions(pool: Question[], count: number) {
  const active = pool.filter(q => q.active);
  if (active.length < count || !active.some(q => q.points > 0)) throw new Error('可用题目不足，或缺少计分题');
  // Guarantee a scored question while sampling without replacement; never reroll a returned attempt.
  const first = shuffle(active.filter(q => q.points > 0))[0];
  return shuffle([first, ...shuffle(active.filter(q => q.id !== first.id)).slice(0, count - 1)]);
}
