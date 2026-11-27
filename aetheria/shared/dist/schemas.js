import { z } from 'zod';
export const OracleUrgencySchema = z.enum(['immediate', 'today', 'this_week', 'info']);
export const OracleStepSchema = z.object({
    n: z.number().int().min(1),
    label: z.string().min(1),
    detail: z.string().min(1)
});
export const OracleImpactItemSchema = z.object({
    metric: z.string().min(1),
    value: z.string().min(1),
    basis: z.string().min(1),
    kind: z.enum(['health', 'money', 'carbon', 'time']),
    isEstimate: z.boolean().default(true)
});
export const OracleRemedySchema = z.object({
    title: z.string().min(1),
    text: z.string().min(1),
    evidence: z.enum(['strong', 'moderate', 'weak'])
});
export const OracleConfidenceSchema = z.object({
    level: z.enum(['high', 'medium', 'low']),
    reason: z.string().min(1)
});
export const OracleActionSchema = z.object({
    type: z.enum(['open_route', 'open_health', 'open_alert', 'set_reminder', 'none']),
    label: z.string().min(1),
    payload: z.record(z.unknown()).default({})
});
export const OracleResponseSchema = z.object({
    title: z.string().min(1),
    urgency: OracleUrgencySchema,
    summary: z.string().min(1),
    assemblyTime: z.string().optional(),
    steps: z.array(OracleStepSchema).min(1).max(6),
    impact: z.array(OracleImpactItemSchema).min(1).max(4),
    remedy: OracleRemedySchema,
    evidenceNote: z.string().min(1),
    safetyNote: z.string().nullable().default(null),
    confidence: OracleConfidenceSchema,
    followUps: z.array(z.string()).min(1).max(4),
    actions: z.array(OracleActionSchema).default([])
});
export const RoutineItemSchema = z.object({
    id: z.string().min(1),
    time: z.string().min(1),
    title: z.string().min(1),
    reason: z.string().min(1),
    impactChip: z.string().min(1),
    secondaryChip: z.string().optional(),
    category: z.enum(['commute', 'ventilation', 'filtration', 'cooking', 'health']),
    icon: z.string().min(1)
});
export const RoutineResponseSchema = z.object({
    items: z.array(RoutineItemSchema).min(3).max(6),
    bestVentilationWindow: z.object({
        startLabel: z.string(),
        endLabel: z.string(),
        reason: z.string(),
        minutesUntilChange: z.number().int().min(0)
    })
});
export const PlaybookDetailSchema = z.object({
    id: z.string(),
    title: z.string(),
    materials: z.array(z.string()),
    timeMinutes: z.number(),
    steps: z.array(z.string()),
    costEstimate: z.string(),
    directImpact: z.string(),
    evidenceLevel: z.enum(['strong', 'moderate', 'weak']),
    evidenceNote: z.string(),
    safetyNote: z.string().nullable()
});
export const HealthDirectivesSchema = z.object({
    safeAqiThreshold: z.number().int().min(10).max(300),
    safePm25Threshold: z.number().min(5).max(200),
    riskStatus: z.string(),
    directives: z.array(z.object({
        title: z.string(),
        subtitle: z.string(),
        body: z.string(),
        icon: z.string(),
        urgency: z.enum(['immediate', 'scheduled', 'info'])
    })).min(2).max(5),
    twilightWarning: z.string(),
    disclaimer: z.string()
});
export const AlertMessageSchema = z.object({
    subject: z.string(),
    body: z.string(),
    protocolCode: z.string()
});
export const VoiceIntentSchema = z.object({
    intent: z.enum([
        'navigate',
        'read_aqi',
        'oracle_question',
        'mark_checklist',
        'log_dose',
        'set_reminder',
        'send_alert',
        'start_route',
        'change_language',
        'tutorial_control',
        'unknown'
    ]),
    params: z.record(z.string()).default({}),
    replyText: z.string(),
    requiresConfirmation: z.boolean().default(false)
});
export const HouseholdMemberGroupSchema = z.enum([
    'infant',
    'toddler',
    'child',
    'adult',
    'elderly',
    'asthma',
    'copd',
    'pregnancy'
]);
export const LocationSchema = z.object({
    name: z.string(),
    country: z.string().optional(),
    lat: z.number(),
    lon: z.number()
});
export const ProfileSchema = z.object({
    householdGroups: z.array(HouseholdMemberGroupSchema).default(['child', 'adult']),
    familySafeMode: z.boolean().default(true),
    homeType: z.enum(['flat', 'house']).default('flat'),
    floor: z.number().int().min(0).max(60).default(2),
    windowsSealed: z.boolean().default(true),
    hasBalcony: z.boolean().default(true),
    fuel: z.enum(['lpg', 'wood', 'coal', 'electric', 'induction']).default('lpg'),
    transport: z.enum(['walk', 'cycle', 'motorbike', 'car', 'bus', 'metro']).default('metro'),
    budget: z.enum(['low', 'moderate', 'flexible']).default('low'),
    purifierOwned: z.boolean().default(false),
    purifierRunning: z.boolean().default(false),
    purifierType: z.enum(['hepaPurifier', 'diyBoxFanMerv13', 'corsiRosenthalCube']).default('diyBoxFanMerv13'),
    pets: z.boolean().default(false),
    plants: z.boolean().default(true),
    units: z.enum(['metric', 'imperial']).default('metric'),
    currency: z.enum(['INR', 'USD']).default('INR'),
    electricityRate: z.number().positive().default(8),
    schoolName: z.string().default('Local Primary School'),
    schoolPhone: z.string().default(''),
    emergencyContactName: z.string().default('Family Caregiver'),
    emergencyContactPhone: z.string().default(''),
    notificationsEnabled: z.boolean().default(false),
    location: LocationSchema.nullable().default(null)
});
