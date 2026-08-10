export const calculateAge = (dateOfBirth: Date, at = new Date()) => {
  let years = at.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  let months = at.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (at.getUTCDate() < dateOfBirth.getUTCDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, totalMonths: Math.max(0, years * 12 + months) };
};

export const weeksBetweenInclusiveFloor = (start: Date, end: Date) => {
  const ms = Math.max(0, end.getTime() - start.getTime());
  return Math.max(1, ms / (1000 * 60 * 60 * 24 * 7));
};
