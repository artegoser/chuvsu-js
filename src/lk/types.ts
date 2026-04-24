export interface PersonalData {
  lastName: string;
  firstName: string;
  patronymic: string;
  sex: string;
  birthday: string;
  recordBookNumber: string;
  faculty: string;
  specialty: string;
  profile: string;
  group: string;
  course: string;
  email: string;
  phone: string;
}

export interface LkCacheConfig {
  personalData?: number;
  photo?: number;
  groupId?: number;
}

export interface LkClientOptions {
  cache?: number | LkCacheConfig;
}
