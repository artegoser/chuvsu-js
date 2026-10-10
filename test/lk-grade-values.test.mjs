import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGradeValue, parseNumericGrade } from '../dist/lk/parse/grade-value.js';
import { LessonType, parseLessonType } from '../dist/index.js';

test('grade values normalize numeric grades and credits while retaining null and zero', () => {
 for (const [text, expected] of [
  ['4 (Хорошо)',4], ['5 (Отлично)',5], ['3 (Удовл.)',3], ['2 (Неудовл.)',2],
  ['0',0], ['100',100], ['4,5',4.5], ['4.5',4.5], ['  ЗАЧТЁНО  ',true],
  ['Не   зачтено',false], ['',null], ['  ',null], ['Отсутствует',null],
  ['4garbage',null], ['-1',null], ['+',null], ['Н',null], ['9'.repeat(400),null],
 ]) assert.equal(parseGradeValue(text),expected,text);
 assert.equal(parseNumericGrade('Зачтено'),null);
});

test('existing lesson enum covers short codes and full LK assessment labels', () => {
 for (const [text,expected] of [
  ['лб',LessonType.Laboratory], ['ЛК.',LessonType.Lecture], ['Лекция',LessonType.Lecture],
  ['Практическое занятие',LessonType.Practical], ['Лабораторная работа',LessonType.Laboratory],
  ['Консультация',LessonType.Consultation], ['Зачет',LessonType.Credit],
  ['Зачёт с оценкой',LessonType.GradedCredit], ['Дифференцированный зачёт',LessonType.GradedCredit],
  ['Экзамен',LessonType.Exam], ['Госэкзамен',LessonType.StateExam], ['Государственный экзамен',LessonType.StateExam],
  ['Защита выпускной квалификационной работы',LessonType.ThesisDefense], ['Защита ВКР',LessonType.ThesisDefense],
  ['Курсовой проект',LessonType.CourseProject], ['зачо',LessonType.GradedCredit],
  ['Неизвестный тип',LessonType.Unknown], ['',LessonType.Unknown],
 ]) assert.equal(parseLessonType(text),expected,text);
 assert.notEqual(LessonType.Exam,LessonType.StateExam);
 assert.equal(LessonType.Krp,11);
});
