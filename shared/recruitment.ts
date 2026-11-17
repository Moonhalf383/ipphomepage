export interface InterviewSlot {
  id: string;
  startAt: number;
  endAt: number;
}
export interface InterviewSchedule {
  id: string;
  title: string;
  location: string;
  description: string;
  slots: InterviewSlot[];
  createdAt: number;
}
export interface InterviewApplication {
  id: string;
  scheduleId: string;
  slotId: string;
  userId: string;
  name: string;
  contact: string;
  note: string;
  createdAt: number;
}
export interface PublicInterviewSchedule extends InterviewSchedule {
  expired: boolean;
  application: InterviewApplication | null;
}
export interface InterviewAdminData {
  schedules: InterviewSchedule[];
  applications: (InterviewApplication & { email: string; displayName: string })[];
}
