import { useEffect, useId, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';

export const JOURNEY_SECTION_TYPES = Object.freeze({
  IDENTITY: 'identity',
  ORGANIZATION: 'organization',
  AGENCY: 'agency',
  CONTRACT: 'contract',
  PRINCIPALS: 'principals',
  DISCLOSURES: 'disclosures',
  LICENSING: 'licensing',
  REGISTRATION: 'registration',
  AML: 'aml',
  ERRORS_AND_OMISSIONS: 'errorsAndOmissions',
  BANKING: 'banking',
  COMMISSION: 'commission',
  HIERARCHY: 'hierarchy',
  APPOINTMENT: 'appointment',
  DOCUMENTS: 'documents',
  ATTESTATIONS: 'attestations',
  CONSENT: 'consent',
  SIGNATURE: 'signature',
  SOURCE: 'source',
  REVIEW: 'review',
});

const STATE_OPTIONS = Object.freeze([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
].map((state) => ({ label: state, value: state })));

const COMPANY_OPTIONS = Object.freeze([
  { label: 'Banner', value: 'Banner' },
  { label: 'William Penn', value: 'WilliamPenn' },
]);

const CONTRACT_TYPE_OPTIONS = Object.freeze([
  { label: 'Producer', value: 'PRODUCER' },
  { label: 'Agency', value: 'AGENCY' },
  { label: 'Solicitor', value: 'SOLICITOR' },
  { label: 'Referral', value: 'REFERRAL' },
  {
    label: 'Registered representative',
    value: 'registered_representative',
  },
]);

const CONTRACT_LEVEL_OPTIONS = Object.freeze([
  { label: 'Producer', value: 'PRODUCER' },
  { label: 'Senior producer', value: 'SENIOR_PRODUCER' },
  { label: 'Agency', value: 'AGENCY' },
  { label: 'General agency', value: 'GENERAL_AGENCY' },
  {
    label: 'Master general agency',
    value: 'MASTER_GENERAL_AGENCY',
  },
]);

const COMMISSION_SCHEDULE_OPTIONS = Object.freeze([
  { label: 'Standard', value: 'STANDARD' },
  { label: 'Senior', value: 'SENIOR' },
  { label: 'Agency', value: 'AGENCY' },
  { label: 'General agency', value: 'GENERAL_AGENCY' },
  { label: 'ABNCA', value: 'ABNCA' },
]);

const PAYMENT_METHOD_OPTIONS = Object.freeze([
  { label: 'Electronic funds transfer', value: 'EFT' },
  { label: 'Direct deposit', value: 'DIRECT_DEPOSIT' },
  { label: 'Agency payment', value: 'AGENCY_PAYMENT' },
]);

const ACCOUNT_TYPE_OPTIONS = Object.freeze([
  { label: 'Checking', value: 'checking' },
  { label: 'Savings', value: 'savings' },
]);

const APPOINTMENT_MODEL_OPTIONS = Object.freeze([
  { label: 'Just in time', value: 'JUST_IN_TIME' },
  { label: 'Pre-appointment', value: 'PRE_APPOINTMENT' },
]);

const AGENCY_TYPE_OPTIONS = Object.freeze([
  { label: 'Brokerage general agency', value: 'BGA' },
  { label: 'Independent marketing organization', value: 'IMO' },
  { label: 'IMO and BGA', value: 'IMO_BGA' },
  { label: 'Direct agency', value: 'DIRECT' },
  {
    label: 'Financial institution',
    value: 'financial_institution',
  },
]);

const optionalTextSchema = z.string().trim().optional().or(z.literal(''));
const requiredTextSchema = (message) => z.string().trim().min(1, message);
const optionalEmailSchema = z
  .string()
  .trim()
  .email('Enter a valid email address.')
  .optional()
  .or(z.literal(''));
const optionalPhoneSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || value.replace(/\D/g, '').length >= 7,
    'Enter a valid phone number.',
  )
  .optional();
const optionalDateSchema = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === '' ||
      /^\d{4}-\d{2}-\d{2}$/.test(value),
    'Enter a valid date.',
  )
  .optional();
const stateSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{2}$/, 'Select a state.');
const optionalNumberSchema = z.preprocess(
  (value) =>
    value === '' || value === null || value === undefined
      ? undefined
      : Number(value),
  z.number().finite().nonnegative().optional(),
);

const identitySchema = z
  .object({
    agent: z
      .object({
        firstName: requiredTextSchema('First name is required.'),
        middleName: optionalTextSchema,
        lastName: requiredTextSchema('Last name is required.'),
        email: optionalEmailSchema,
        phone: optionalPhoneSchema,
        npn: z
          .string()
          .trim()
          .regex(/^\d{5,10}$/, 'NPN must contain 5 to 10 digits.'),
        residenceState: stateSchema,
        dateOfBirth: optionalDateSchema,
      })
      .passthrough(),
  })
  .passthrough();

const organizationSchema = z
  .object({
    organization: z
      .object({
        legalName: requiredTextSchema(
          'Organization legal name is required.',
        ),
        email: optionalEmailSchema,
        phone: optionalPhoneSchema,
        stateOfFormation: stateSchema,
        taxIdLast4: z
          .string()
          .trim()
          .regex(/^\d{4}$/, 'Enter the last four digits.')
          .optional()
          .or(z.literal('')),
      })
      .passthrough(),
  })
  .passthrough();

const agencySchema = z
  .object({
    agency: z
      .object({
        name: requiredTextSchema('Agency name is required.'),
        type: requiredTextSchema('Agency type is required.'),
        code: optionalTextSchema,
      })
      .passthrough(),
    gaCode: requiredTextSchema(
      'General agency code is required.',
    ),
  })
  .passthrough();

const contractSchema = z
  .object({
    company: requiredTextSchema('Company is required.'),
    contract: z
      .object({
        type: requiredTextSchema('Contract type is required.'),
        level: requiredTextSchema('Contract level is required.'),
        commissionSchedule: requiredTextSchema(
          'Commission schedule is required.',
        ),
        advanceCommission: z.boolean().default(false),
      })
      .passthrough(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (
      value.contract.commissionSchedule === 'ABNCA' &&
      value.contract.advanceCommission
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ABNCA prohibits advance commission.',
        path: ['contract', 'advanceCommission'],
      });
    }

    if (
      value.company === 'WilliamPenn' &&
      value.contract.level === 'AGENCY'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'William Penn does not support the selected agency level.',
        path: ['contract', 'level'],
      });
    }
  });

const principalSchema = z
  .object({
    firstName: requiredTextSchema('First name is required.'),
    lastName: requiredTextSchema('Last name is required.'),
    email: optionalEmailSchema,
    ownershipPercent: z.preprocess(
      (value) =>
        value === '' || value === null || value === undefined
          ? undefined
          : Number(value),
      z
        .number({
          required_error: 'Ownership percentage is required.',
          invalid_type_error: 'Enter a valid ownership percentage.',
        })
        .min(0, 'Ownership percentage cannot be negative.')
        .max(100, 'Ownership percentage cannot exceed 100.'),
    ),
    npn: optionalTextSchema,
    isLicensedEligible: z.boolean().default(false),
  })
  .passthrough();

const principalsSchema = z
  .object({
    principals: z
      .array(principalSchema)
      .min(1, 'Add at least one licensed principal.')
      .refine(
        (principals) =>
          principals.some(
            (principal) => principal.isLicensedEligible === true,
          ),
        'At least one principal must be licensed and eligible.',
      ),
  })
  .passthrough();

const disclosuresSchema = z
  .object({
    disclosures: z
      .object({
        criminalHistory: z.boolean().default(false),
        regulatoryAction: z.boolean().default(false),
        bankruptcy: z.boolean().default(false),
        explanation: optionalTextSchema,
      })
      .passthrough()
      .superRefine((value, context) => {
        if (
          (value.criminalHistory ||
            value.regulatoryAction ||
            value.bankruptcy) &&
          !value.explanation?.trim()
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Provide an explanation for each disclosed condition.',
            path: ['explanation'],
          });
        }
      }),
  })
  .passthrough();

const licensingSchema = z
  .object({
    licensing: z
      .object({
        residentState: stateSchema,
        licenseNumber: requiredTextSchema(
          'License number is required.',
        ),
        linesOfAuthority: z
          .string()
          .trim()
          .min(1, 'At least one line of authority is required.'),
      })
      .passthrough(),
  })
  .passthrough();

const registrationSchema = z
  .object({
    agent: z
      .object({
        crd: requiredTextSchema('CRD number is required.'),
      })
      .passthrough(),
    registration: z
      .object({
        brokerDealer: requiredTextSchema(
          'Broker-dealer name is required.',
        ),
        status: requiredTextSchema(
          'Registration status is required.',
        ),
      })
      .passthrough(),
  })
  .passthrough();

const amlSchema = z
  .object({
    aml: z
      .object({
        screeningKey: optionalTextSchema,
        status: requiredTextSchema('AML status is required.'),
        riskLevel: requiredTextSchema('Risk level is required.'),
        manualReviewRequired: z.boolean().default(false),
        notes: optionalTextSchema,
      })
      .passthrough(),
  })
  .passthrough();

const errorsAndOmissionsSchema = z
  .object({
    errorsAndOmissions: z
      .object({
        policyNumber: requiredTextSchema(
          'Policy number is required.',
        ),
        carrier: requiredTextSchema('E&O carrier is required.'),
        expirationDate: requiredTextSchema(
          'Expiration date is required.',
        ).refine(
          (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
          'Enter a valid expiration date.',
        ),
        coverageAmount: optionalNumberSchema,
      })
      .passthrough(),
  })
  .passthrough();

const bankingSchema = z
  .object({
    banking: z
      .object({
        paymentMethod: requiredTextSchema(
          'Payment method is required.',
        ),
        routingNumber: z
          .string()
          .trim()
          .regex(/^\d{9}$/, 'Routing number must contain 9 digits.'),
        accountNumber: z
          .string()
          .trim()
          .min(4, 'Account number must contain at least 4 characters.'),
        accountType: requiredTextSchema(
          'Account type is required.',
        ),
        accountHolderName: requiredTextSchema(
          'Account holder name is required.',
        ),
      })
      .passthrough(),
  })
  .passthrough();

const commissionSchema = z
  .object({
    commission: z
      .object({
        schedule: requiredTextSchema(
          'Commission schedule is required.',
        ),
        paymentMethod: requiredTextSchema(
          'Payment method is required.',
        ),
        advanceCommission: z.boolean().default(false),
      })
      .passthrough()
      .superRefine((value, context) => {
        if (
          value.schedule === 'ABNCA' &&
          value.advanceCommission
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'ABNCA prohibits advance commission.',
            path: ['advanceCommission'],
          });
        }
      }),
  })
  .passthrough();

const hierarchySchema = z
  .object({
    gaCode: requiredTextSchema(
      'General agency code is required.',
    ),
    hierarchy: z
      .object({
        agencyCode: requiredTextSchema(
          'Agency code is required.',
        ),
        uplineAgentCode: optionalTextSchema,
        level: requiredTextSchema('Hierarchy level is required.'),
      })
      .passthrough(),
  })
  .passthrough();

const appointmentSchema = z
  .object({
    appointment: z
      .object({
        model: requiredTextSchema(
          'Appointment model is required.',
        ),
        states: z
          .string()
          .trim()
          .min(1, 'At least one appointment state is required.'),
        providerCode: optionalTextSchema,
        requested: z.boolean().default(false),
      })
      .passthrough(),
  })
  .passthrough();

const documentsSchema = z
  .object({
    documents: z
      .object({
        required: optionalNumberSchema,
        received: optionalNumberSchema,
        accepted: optionalNumberSchema,
        notes: optionalTextSchema,
      })
      .passthrough()
      .superRefine((value, context) => {
        if (
          value.received !== undefined &&
          value.required !== undefined &&
          value.received > value.required
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Received documents cannot exceed required documents.',
            path: ['received'],
          });
        }

        if (
          value.accepted !== undefined &&
          value.received !== undefined &&
          value.accepted > value.received
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Accepted documents cannot exceed received documents.',
            path: ['accepted'],
          });
        }
      }),
  })
  .passthrough();

const attestationsSchema = z
  .object({
    attestations: z
      .object({
        backgroundQuestionsClear: z.boolean().default(false),
        informationAccurate: z
          .boolean()
          .refine(
            (value) => value,
            'Confirm that the information is accurate.',
          ),
        electronicDeliveryConsent: z
          .boolean()
          .refine(
            (value) => value,
            'Electronic delivery consent is required.',
          ),
      })
      .passthrough(),
  })
  .passthrough();

const consentSchema = z
  .object({
    consent: z
      .object({
        privacyNoticeAccepted: z
          .boolean()
          .refine(
            (value) => value,
            'Privacy notice acceptance is required.',
          ),
        electronicDeliveryConsent: z
          .boolean()
          .refine(
            (value) => value,
            'Electronic delivery consent is required.',
          ),
        esignConsent: z
          .boolean()
          .refine(
            (value) => value,
            'Electronic-signature consent is required.',
          ),
      })
      .passthrough(),
  })
  .passthrough();

const signatureSchema = z
  .object({
    signOff: z
      .object({
        signedBy: requiredTextSchema('Signer name is required.'),
        consented: z
          .boolean()
          .refine(
            (value) => value,
            'Electronic-signature consent is required.',
          ),
      })
      .passthrough(),
  })
  .passthrough();

const sourceSchema = z
  .object({
    sourceMetadata: z
      .object({
        sourceChannel: requiredTextSchema(
          'Source channel is required.',
        ),
        sourceFormat: requiredTextSchema(
          'Source format is required.',
        ),
        partnerCode: requiredTextSchema(
          'Partner code is required.',
        ),
        fileName: optionalTextSchema,
      })
      .passthrough(),
  })
  .passthrough();

const emptySectionSchema = z.object({}).passthrough();

export const JOURNEY_SECTION_SCHEMAS = Object.freeze({
  [JOURNEY_SECTION_TYPES.IDENTITY]: identitySchema,
  [JOURNEY_SECTION_TYPES.ORGANIZATION]: organizationSchema,
  [JOURNEY_SECTION_TYPES.AGENCY]: agencySchema,
  [JOURNEY_SECTION_TYPES.CONTRACT]: contractSchema,
  [JOURNEY_SECTION_TYPES.PRINCIPALS]: principalsSchema,
  [JOURNEY_SECTION_TYPES.DISCLOSURES]: disclosuresSchema,
  [JOURNEY_SECTION_TYPES.LICENSING]: licensingSchema,
  [JOURNEY_SECTION_TYPES.REGISTRATION]: registrationSchema,
  [JOURNEY_SECTION_TYPES.AML]: amlSchema,
  [JOURNEY_SECTION_TYPES.ERRORS_AND_OMISSIONS]:
    errorsAndOmissionsSchema,
  [JOURNEY_SECTION_TYPES.BANKING]: bankingSchema,
  [JOURNEY_SECTION_TYPES.COMMISSION]: commissionSchema,
  [JOURNEY_SECTION_TYPES.HIERARCHY]: hierarchySchema,
  [JOURNEY_SECTION_TYPES.APPOINTMENT]: appointmentSchema,
  [JOURNEY_SECTION_TYPES.DOCUMENTS]: documentsSchema,
  [JOURNEY_SECTION_TYPES.ATTESTATIONS]: attestationsSchema,
  [JOURNEY_SECTION_TYPES.CONSENT]: consentSchema,
  [JOURNEY_SECTION_TYPES.SIGNATURE]: signatureSchema,
  [JOURNEY_SECTION_TYPES.SOURCE]: sourceSchema,
  [JOURNEY_SECTION_TYPES.REVIEW]: emptySectionSchema,
});

const SECTION_ALIASES = Object.freeze({
  applicant: JOURNEY_SECTION_TYPES.IDENTITY,
  identity: JOURNEY_SECTION_TYPES.IDENTITY,
  organization: JOURNEY_SECTION_TYPES.ORGANIZATION,
  agency: JOURNEY_SECTION_TYPES.AGENCY,
  contract: JOURNEY_SECTION_TYPES.CONTRACT,
  principals: JOURNEY_SECTION_TYPES.PRINCIPALS,
  disclosures: JOURNEY_SECTION_TYPES.DISCLOSURES,
  licensing: JOURNEY_SECTION_TYPES.LICENSING,
  registration: JOURNEY_SECTION_TYPES.REGISTRATION,
  aml: JOURNEY_SECTION_TYPES.AML,
  errors_and_omissions:
    JOURNEY_SECTION_TYPES.ERRORS_AND_OMISSIONS,
  errorsandomissions:
    JOURNEY_SECTION_TYPES.ERRORS_AND_OMISSIONS,
  eo: JOURNEY_SECTION_TYPES.ERRORS_AND_OMISSIONS,
  banking: JOURNEY_SECTION_TYPES.BANKING,
  bank: JOURNEY_SECTION_TYPES.BANKING,
  commission: JOURNEY_SECTION_TYPES.COMMISSION,
  hierarchy: JOURNEY_SECTION_TYPES.HIERARCHY,
  appointment: JOURNEY_SECTION_TYPES.APPOINTMENT,
  documents: JOURNEY_SECTION_TYPES.DOCUMENTS,
  attestations: JOURNEY_SECTION_TYPES.ATTESTATIONS,
  consent: JOURNEY_SECTION_TYPES.CONSENT,
  signature: JOURNEY_SECTION_TYPES.SIGNATURE,
  sign_off: JOURNEY_SECTION_TYPES.SIGNATURE,
  source: JOURNEY_SECTION_TYPES.SOURCE,
  source_review: JOURNEY_SECTION_TYPES.SOURCE,
  review: JOURNEY_SECTION_TYPES.REVIEW,
  start: JOURNEY_SECTION_TYPES.REVIEW,
  complete: JOURNEY_SECTION_TYPES.REVIEW,
});

const SECTION_DEFINITIONS = Object.freeze({
  [JOURNEY_SECTION_TYPES.IDENTITY]: Object.freeze({
    title: 'Applicant identity',
    description:
      'Enter the applicant identity and contact information.',
    fields: Object.freeze([
      {
        name: 'agent.firstName',
        label: 'First name',
        required: true,
        autoComplete: 'given-name',
      },
      {
        name: 'agent.middleName',
        label: 'Middle name',
        autoComplete: 'additional-name',
      },
      {
        name: 'agent.lastName',
        label: 'Last name',
        required: true,
        autoComplete: 'family-name',
      },
      {
        name: 'agent.email',
        label: 'Email address',
        type: 'email',
        autoComplete: 'email',
      },
      {
        name: 'agent.phone',
        label: 'Phone number',
        type: 'tel',
        autoComplete: 'tel',
      },
      {
        name: 'agent.npn',
        label: 'National producer number (NPN)',
        required: true,
        inputMode: 'numeric',
      },
      {
        name: 'agent.residenceState',
        label: 'Residence state',
        type: 'select',
        required: true,
        options: STATE_OPTIONS,
      },
      {
        name: 'agent.dateOfBirth',
        label: 'Date of birth',
        type: 'date',
        autoComplete: 'bday',
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.ORGANIZATION]: Object.freeze({
    title: 'Organization details',
    description:
      'Enter the legal identity and contact information for the organization.',
    fields: Object.freeze([
      {
        name: 'organization.legalName',
        label: 'Legal name',
        required: true,
        autoComplete: 'organization',
      },
      {
        name: 'organization.email',
        label: 'Contact email',
        type: 'email',
        autoComplete: 'email',
      },
      {
        name: 'organization.phone',
        label: 'Contact phone',
        type: 'tel',
        autoComplete: 'tel',
      },
      {
        name: 'organization.stateOfFormation',
        label: 'State of formation',
        type: 'select',
        required: true,
        options: STATE_OPTIONS,
      },
      {
        name: 'organization.taxIdLast4',
        label: 'Tax identifier last four digits',
        inputMode: 'numeric',
        sensitive: true,
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.AGENCY]: Object.freeze({
    title: 'Agency details',
    description:
      'Enter the agency and general agency relationship.',
    fields: Object.freeze([
      {
        name: 'agency.name',
        label: 'Agency name',
        required: true,
      },
      {
        name: 'agency.type',
        label: 'Agency type',
        type: 'select',
        required: true,
        options: AGENCY_TYPE_OPTIONS,
      },
      {
        name: 'agency.code',
        label: 'Agency code',
      },
      {
        name: 'gaCode',
        label: 'General agency code',
        required: true,
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.CONTRACT]: Object.freeze({
    title: 'Contract details',
    description:
      'Select the carrier, contract type, level, and commission schedule.',
    fields: Object.freeze([
      {
        name: 'company',
        label: 'Company',
        type: 'select',
        required: true,
        options: COMPANY_OPTIONS,
      },
      {
        name: 'contract.type',
        label: 'Contract type',
        type: 'select',
        required: true,
        options: CONTRACT_TYPE_OPTIONS,
      },
      {
        name: 'contract.level',
        label: 'Contract level',
        type: 'select',
        required: true,
        options: CONTRACT_LEVEL_OPTIONS,
      },
      {
        name: 'contract.commissionSchedule',
        label: 'Commission schedule',
        type: 'select',
        required: true,
        options: COMMISSION_SCHEDULE_OPTIONS,
      },
      {
        name: 'contract.advanceCommission',
        label: 'Request advance commission',
        type: 'checkbox',
        fullWidth: true,
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.PRINCIPALS]: Object.freeze({
    title: 'Licensed principals',
    description:
      'Add ownership and licensing information for corporate principals.',
    fields: Object.freeze([]),
  }),
  [JOURNEY_SECTION_TYPES.DISCLOSURES]: Object.freeze({
    title: 'Disclosures',
    description:
      'Answer the background and regulatory disclosure questions.',
    fields: Object.freeze([
      {
        name: 'disclosures.criminalHistory',
        label: 'Criminal history has been disclosed',
        type: 'checkbox',
        fullWidth: true,
      },
      {
        name: 'disclosures.regulatoryAction',
        label: 'Regulatory action has been disclosed',
        type: 'checkbox',
        fullWidth: true,
      },
      {
        name: 'disclosures.bankruptcy',
        label: 'Bankruptcy has been disclosed',
        type: 'checkbox',
        fullWidth: true,
      },
      {
        name: 'disclosures.explanation',
        label: 'Disclosure explanation',
        type: 'textarea',
        rows: 4,
        fullWidth: true,
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.LICENSING]: Object.freeze({
    title: 'Licensing',
    description:
      'Enter resident licensing and lines of authority.',
    fields: Object.freeze([
      {
        name: 'licensing.residentState',
        label: 'Resident state',
        type: 'select',
        required: true,
        options: STATE_OPTIONS,
      },
      {
        name: 'licensing.licenseNumber',
        label: 'License number',
        required: true,
        sensitive: true,
      },
      {
        name: 'licensing.linesOfAuthority',
        label: 'Lines of authority',
        required: true,
        helpText:
          'Enter multiple lines separated by commas, for example LIFE, ACCIDENT_HEALTH.',
        fullWidth: true,
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.REGISTRATION]: Object.freeze({
    title: 'Registration',
    description:
      'Enter registered-representative and broker-dealer information.',
    fields: Object.freeze([
      {
        name: 'agent.crd',
        label: 'CRD number',
        required: true,
        inputMode: 'numeric',
      },
      {
        name: 'registration.brokerDealer',
        label: 'Broker-dealer',
        required: true,
      },
      {
        name: 'registration.status',
        label: 'Registration status',
        type: 'select',
        required: true,
        options: [
          { label: 'Active', value: 'ACTIVE' },
          { label: 'Pending', value: 'PENDING' },
          { label: 'Inactive', value: 'INACTIVE' },
        ],
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.AML]: Object.freeze({
    title: 'AML screening',
    description:
      'Review the simulated anti-money laundering screening outcome.',
    fields: Object.freeze([
      {
        name: 'aml.screeningKey',
        label: 'Screening reference',
      },
      {
        name: 'aml.status',
        label: 'Screening status',
        type: 'select',
        required: true,
        options: [
          { label: 'Not started', value: 'NOT_STARTED' },
          { label: 'Pending', value: 'PENDING' },
          { label: 'Complete', value: 'COMPLETE' },
        ],
      },
      {
        name: 'aml.riskLevel',
        label: 'Risk level',
        type: 'select',
        required: true,
        options: [
          { label: 'Low', value: 'LOW' },
          { label: 'Medium', value: 'MEDIUM' },
          { label: 'High', value: 'HIGH' },
          { label: 'Unknown', value: 'UNKNOWN' },
        ],
      },
      {
        name: 'aml.manualReviewRequired',
        label: 'Manual AML review required',
        type: 'checkbox',
        fullWidth: true,
      },
      {
        name: 'aml.notes',
        label: 'Screening notes',
        type: 'textarea',
        rows: 4,
        fullWidth: true,
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.ERRORS_AND_OMISSIONS]: Object.freeze({
    title: 'Errors and omissions coverage',
    description:
      'Enter active errors and omissions insurance information.',
    fields: Object.freeze([
      {
        name: 'errorsAndOmissions.policyNumber',
        label: 'Policy number',
        required: true,
        sensitive: true,
      },
      {
        name: 'errorsAndOmissions.carrier',
        label: 'Insurance carrier',
        required: true,
      },
      {
        name: 'errorsAndOmissions.expirationDate',
        label: 'Expiration date',
        type: 'date',
        required: true,
      },
      {
        name: 'errorsAndOmissions.coverageAmount',
        label: 'Coverage amount',
        type: 'number',
        min: 0,
        inputMode: 'decimal',
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.BANKING]: Object.freeze({
    title: 'Banking',
    description:
      'Enter payment information using synthetic data only.',
    fields: Object.freeze([
      {
        name: 'banking.paymentMethod',
        label: 'Payment method',
        type: 'select',
        required: true,
        options: PAYMENT_METHOD_OPTIONS,
      },
      {
        name: 'banking.accountType',
        label: 'Account type',
        type: 'select',
        required: true,
        options: ACCOUNT_TYPE_OPTIONS,
      },
      {
        name: 'banking.routingNumber',
        label: 'Routing number',
        required: true,
        sensitive: true,
        inputMode: 'numeric',
        autoComplete: 'off',
      },
      {
        name: 'banking.accountNumber',
        label: 'Account number',
        required: true,
        sensitive: true,
        autoComplete: 'off',
      },
      {
        name: 'banking.accountHolderName',
        label: 'Account holder name',
        required: true,
        autoComplete: 'off',
        fullWidth: true,
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.COMMISSION]: Object.freeze({
    title: 'Commission',
    description:
      'Select the commission schedule and payment method.',
    fields: Object.freeze([
      {
        name: 'commission.schedule',
        label: 'Commission schedule',
        type: 'select',
        required: true,
        options: COMMISSION_SCHEDULE_OPTIONS,
      },
      {
        name: 'commission.paymentMethod',
        label: 'Payment method',
        type: 'select',
        required: true,
        options: PAYMENT_METHOD_OPTIONS,
      },
      {
        name: 'commission.advanceCommission',
        label: 'Request advance commission',
        type: 'checkbox',
        fullWidth: true,
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.HIERARCHY]: Object.freeze({
    title: 'Hierarchy',
    description:
      'Enter the contracting and distribution hierarchy.',
    fields: Object.freeze([
      {
        name: 'gaCode',
        label: 'General agency code',
        required: true,
      },
      {
        name: 'hierarchy.agencyCode',
        label: 'Agency code',
        required: true,
      },
      {
        name: 'hierarchy.uplineAgentCode',
        label: 'Upline agent code',
      },
      {
        name: 'hierarchy.level',
        label: 'Hierarchy level',
        type: 'select',
        required: true,
        options: CONTRACT_LEVEL_OPTIONS,
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.APPOINTMENT]: Object.freeze({
    title: 'Appointment',
    description:
      'Enter the carrier appointment request information.',
    fields: Object.freeze([
      {
        name: 'appointment.model',
        label: 'Appointment model',
        type: 'select',
        required: true,
        options: APPOINTMENT_MODEL_OPTIONS,
      },
      {
        name: 'appointment.states',
        label: 'Appointment states',
        required: true,
        helpText:
          'Enter multiple state codes separated by commas.',
      },
      {
        name: 'appointment.providerCode',
        label: 'Provider code',
      },
      {
        name: 'appointment.requested',
        label: 'Submit appointment request',
        type: 'checkbox',
        fullWidth: true,
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.DOCUMENTS]: Object.freeze({
    title: 'Documents',
    description:
      'Review document counts and add package notes.',
    fields: Object.freeze([
      {
        name: 'documents.required',
        label: 'Required documents',
        type: 'number',
        min: 0,
      },
      {
        name: 'documents.received',
        label: 'Received documents',
        type: 'number',
        min: 0,
      },
      {
        name: 'documents.accepted',
        label: 'Accepted documents',
        type: 'number',
        min: 0,
      },
      {
        name: 'documents.notes',
        label: 'Document notes',
        type: 'textarea',
        rows: 4,
        fullWidth: true,
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.ATTESTATIONS]: Object.freeze({
    title: 'Attestations',
    description:
      'Confirm disclosures, accuracy, and electronic delivery consent.',
    fields: Object.freeze([
      {
        name: 'attestations.backgroundQuestionsClear',
        label: 'Background questions are answered accurately',
        type: 'checkbox',
        fullWidth: true,
      },
      {
        name: 'attestations.informationAccurate',
        label: 'I confirm that the information is accurate',
        type: 'checkbox',
        required: true,
        fullWidth: true,
      },
      {
        name: 'attestations.electronicDeliveryConsent',
        label: 'I consent to electronic delivery',
        type: 'checkbox',
        required: true,
        fullWidth: true,
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.CONSENT]: Object.freeze({
    title: 'Consent',
    description:
      'Review and accept the required privacy and electronic consent statements.',
    fields: Object.freeze([
      {
        name: 'consent.privacyNoticeAccepted',
        label: 'I have reviewed and accept the privacy notice',
        type: 'checkbox',
        required: true,
        fullWidth: true,
      },
      {
        name: 'consent.electronicDeliveryConsent',
        label: 'I consent to electronic delivery',
        type: 'checkbox',
        required: true,
        fullWidth: true,
      },
      {
        name: 'consent.esignConsent',
        label: 'I consent to use an electronic signature',
        type: 'checkbox',
        required: true,
        fullWidth: true,
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.SIGNATURE]: Object.freeze({
    title: 'Electronic signature',
    description:
      'Confirm the signer and consent to electronically sign the package.',
    fields: Object.freeze([
      {
        name: 'signOff.signedBy',
        label: 'Signer name',
        required: true,
        autoComplete: 'name',
      },
      {
        name: 'signOff.consented',
        label: 'I consent to electronically sign this package',
        type: 'checkbox',
        required: true,
        fullWidth: true,
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.SOURCE]: Object.freeze({
    title: 'Source review',
    description:
      'Review the imported source information before continuing.',
    fields: Object.freeze([
      {
        name: 'sourceMetadata.sourceChannel',
        label: 'Source channel',
        required: true,
        readOnly: true,
      },
      {
        name: 'sourceMetadata.sourceFormat',
        label: 'Source format',
        required: true,
        readOnly: true,
      },
      {
        name: 'sourceMetadata.partnerCode',
        label: 'Partner code',
        required: true,
        readOnly: true,
      },
      {
        name: 'sourceMetadata.fileName',
        label: 'File name',
        readOnly: true,
      },
    ]),
  }),
  [JOURNEY_SECTION_TYPES.REVIEW]: Object.freeze({
    title: 'Review',
    description:
      'Review the information in this journey before continuing.',
    fields: Object.freeze([]),
  }),
});

const DEFAULT_VALUES = Object.freeze({
  [JOURNEY_SECTION_TYPES.IDENTITY]: {
    agent: {
      firstName: '',
      middleName: '',
      lastName: '',
      email: '',
      phone: '',
      npn: '',
      residenceState: '',
      dateOfBirth: '',
    },
  },
  [JOURNEY_SECTION_TYPES.ORGANIZATION]: {
    organization: {
      legalName: '',
      email: '',
      phone: '',
      stateOfFormation: '',
      taxIdLast4: '',
    },
  },
  [JOURNEY_SECTION_TYPES.AGENCY]: {
    agency: { name: '', type: '', code: '' },
    gaCode: '',
  },
  [JOURNEY_SECTION_TYPES.CONTRACT]: {
    company: '',
    contract: {
      type: '',
      level: '',
      commissionSchedule: '',
      advanceCommission: false,
    },
  },
  [JOURNEY_SECTION_TYPES.PRINCIPALS]: {
    principals: [
      {
        firstName: '',
        lastName: '',
        email: '',
        ownershipPercent: '',
        npn: '',
        isLicensedEligible: false,
      },
    ],
  },
  [JOURNEY_SECTION_TYPES.DISCLOSURES]: {
    disclosures: {
      criminalHistory: false,
      regulatoryAction: false,
      bankruptcy: false,
      explanation: '',
    },
  },
  [JOURNEY_SECTION_TYPES.LICENSING]: {
    licensing: {
      residentState: '',
      licenseNumber: '',
      linesOfAuthority: '',
    },
  },
  [JOURNEY_SECTION_TYPES.REGISTRATION]: {
    agent: { crd: '' },
    registration: { brokerDealer: '', status: '' },
  },
  [JOURNEY_SECTION_TYPES.AML]: {
    aml: {
      screeningKey: '',
      status: '',
      riskLevel: '',
      manualReviewRequired: false,
      notes: '',
    },
  },
  [JOURNEY_SECTION_TYPES.ERRORS_AND_OMISSIONS]: {
    errorsAndOmissions: {
      policyNumber: '',
      carrier: '',
      expirationDate: '',
      coverageAmount: '',
    },
  },
  [JOURNEY_SECTION_TYPES.BANKING]: {
    banking: {
      paymentMethod: '',
      routingNumber: '',
      accountNumber: '',
      accountType: '',
      accountHolderName: '',
    },
  },
  [JOURNEY_SECTION_TYPES.COMMISSION]: {
    commission: {
      schedule: '',
      paymentMethod: '',
      advanceCommission: false,
    },
  },
  [JOURNEY_SECTION_TYPES.HIERARCHY]: {
    gaCode: '',
    hierarchy: {
      agencyCode: '',
      uplineAgentCode: '',
      level: '',
    },
  },
  [JOURNEY_SECTION_TYPES.APPOINTMENT]: {
    appointment: {
      model: '',
      states: '',
      providerCode: '',
      requested: false,
    },
  },
  [JOURNEY_SECTION_TYPES.DOCUMENTS]: {
    documents: {
      required: '',
      received: '',
      accepted: '',
      notes: '',
    },
  },
  [JOURNEY_SECTION_TYPES.ATTESTATIONS]: {
    attestations: {
      backgroundQuestionsClear: false,
      informationAccurate: false,
      electronicDeliveryConsent: false,
    },
  },
  [JOURNEY_SECTION_TYPES.CONSENT]: {
    consent: {
      privacyNoticeAccepted: false,
      electronicDeliveryConsent: false,
      esignConsent: false,
    },
  },
  [JOURNEY_SECTION_TYPES.SIGNATURE]: {
    signOff: {
      signedBy: '',
      consented: false,
    },
  },
  [JOURNEY_SECTION_TYPES.SOURCE]: {
    sourceMetadata: {
      sourceChannel: '',
      sourceFormat: '',
      partnerCode: '',
      fileName: '',
    },
  },
  [JOURNEY_SECTION_TYPES.REVIEW]: {},
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function mergeValues(baseValue, overlayValue) {
  if (!isObject(baseValue) || !isObject(overlayValue)) {
    return overlayValue === undefined
      ? cloneValue(baseValue)
      : cloneValue(overlayValue);
  }

  const mergedValue = cloneValue(baseValue);

  Object.entries(overlayValue).forEach(([key, value]) => {
    if (isObject(value) && isObject(mergedValue[key])) {
      mergedValue[key] = mergeValues(mergedValue[key], value);
    } else {
      mergedValue[key] = cloneValue(value);
    }
  });

  return mergedValue;
}

function normalizeSection(section) {
  const value = isObject(section)
    ? section.section ?? section.id ?? section.stepId
    : section;

  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return JOURNEY_SECTION_TYPES.REVIEW;
  }

  const normalizedValue = String(value)
    .trim()
    .normalize('NFKC')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return (
    SECTION_ALIASES[normalizedValue] ??
    (Object.hasOwn(SECTION_DEFINITIONS, value)
      ? value
      : JOURNEY_SECTION_TYPES.REVIEW)
  );
}

/**
 * Returns the built-in Zod schema for a journey section.
 *
 * @param {string | object} section Section identifier or step definition.
 * @returns {z.ZodTypeAny} Section schema.
 */
export function getJourneySectionSchema(section) {
  const sectionKey = normalizeSection(section);

  return JOURNEY_SECTION_SCHEMAS[sectionKey] ?? emptySectionSchema;
}

/**
 * Returns the built-in presentation definition for a journey section.
 *
 * @param {string | object} section Section identifier or step definition.
 * @returns {object} Section definition.
 */
export function getJourneySectionDefinition(section) {
  const sectionKey = normalizeSection(section);

  return SECTION_DEFINITIONS[sectionKey] ??
    SECTION_DEFINITIONS[JOURNEY_SECTION_TYPES.REVIEW];
}

function getErrorAtPath(errors, path) {
  return String(path)
    .split('.')
    .reduce((value, segment) => value?.[segment], errors);
}

function collectErrorMessages(value, messages = []) {
  if (!value || typeof value !== 'object') {
    return messages;
  }

  if (typeof value.message === 'string') {
    messages.push(value.message);
  }

  Object.entries(value).forEach(([key, nestedValue]) => {
    if (!['message', 'ref', 'type', 'types'].includes(key)) {
      collectErrorMessages(nestedValue, messages);
    }
  });

  return messages;
}

function FieldError({ error, id }) {
  if (!error?.message) {
    return null;
  }

  return (
    <p
      className="mt-1 text-sm text-danger dark:text-red-200"
      id={id}
      role="alert"
    >
      {error.message}
    </p>
  );
}

FieldError.propTypes = {
  error: PropTypes.shape({
    message: PropTypes.string,
  }),
  id: PropTypes.string.isRequired,
};

function FormField({
  disabled,
  error,
  field,
  idPrefix,
  readOnly,
  register,
}) {
  const inputId = `${idPrefix}-${field.name.replace(/[^A-Za-z0-9]+/g, '-')}`;
  const errorId = `${inputId}-error`;
  const helpId = `${inputId}-help`;
  const describedBy = [
    field.helpText ? helpId : null,
    error?.message ? errorId : null,
  ]
    .filter(Boolean)
    .join(' ');
  const isCheckbox = field.type === 'checkbox';
  const registration = register(field.name, {
    ...(field.type === 'number' ? { valueAsNumber: true } : {}),
  });
  const commonInputProps = {
    ...registration,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': Boolean(error),
    disabled,
    id: inputId,
    readOnly: readOnly || field.readOnly === true,
  };

  if (isCheckbox) {
    return (
      <div
        className={`${
          field.fullWidth ? 'sm:col-span-2' : ''
        }`.trim()}
      >
        <label
          className="flex min-h-11 items-start gap-3 rounded-lg border border-border bg-white px-3 py-3 text-sm text-text dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          htmlFor={inputId}
        >
          <input
            {...commonInputProps}
            className="mt-0.5 size-5 shrink-0 rounded border-border text-lga-navy focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800"
            type="checkbox"
          />
          <span>
            <span className="font-medium">
              {field.label}
              {field.required && (
                <span aria-hidden="true" className="ml-1 text-danger">
                  *
                </span>
              )}
            </span>
            {field.helpText && (
              <span
                className="mt-1 block text-xs leading-5 text-text-muted dark:text-slate-400"
                id={helpId}
              >
                {field.helpText}
              </span>
            )}
          </span>
        </label>
        <FieldError error={error} id={errorId} />
      </div>
    );
  }

  const inputClassName =
    'mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm transition-colors placeholder:text-slate-400 focus:border-lga-sky focus:outline-none focus:ring-2 focus:ring-lga-sky disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:disabled:bg-slate-800';

  return (
    <div
      className={`${
        field.fullWidth ? 'sm:col-span-2' : ''
      }`.trim()}
    >
      <label
        className="block text-sm font-medium text-text dark:text-slate-100"
        htmlFor={inputId}
      >
        {field.label}
        {field.required && (
          <span aria-hidden="true" className="ml-1 text-danger">
            *
          </span>
        )}
      </label>

      {field.type === 'select' ? (
        <select
          {...commonInputProps}
          className={inputClassName}
        >
          <option value="">
            {field.placeholder ?? `Select ${field.label.toLowerCase()}`}
          </option>
          {(field.options ?? []).map((option) => {
            const optionValue = isObject(option)
              ? option.value
              : option;
            const optionLabel = isObject(option)
              ? option.label
              : option;

            return (
              <option key={String(optionValue)} value={optionValue}>
                {optionLabel}
              </option>
            );
          })}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          {...commonInputProps}
          className={`${inputClassName} min-h-28 resize-y`}
          placeholder={field.placeholder}
          rows={field.rows ?? 3}
        />
      ) : (
        <input
          {...commonInputProps}
          autoComplete={
            field.sensitive ? 'off' : field.autoComplete
          }
          className={inputClassName}
          inputMode={field.inputMode}
          max={field.max}
          min={field.min}
          placeholder={field.placeholder}
          step={field.step}
          type={field.type ?? 'text'}
        />
      )}

      {field.helpText && (
        <p
          className="mt-1 text-xs leading-5 text-text-muted dark:text-slate-400"
          id={helpId}
        >
          {field.helpText}
        </p>
      )}
      <FieldError error={error} id={errorId} />
    </div>
  );
}

FormField.propTypes = {
  disabled: PropTypes.bool.isRequired,
  error: PropTypes.shape({
    message: PropTypes.string,
  }),
  field: PropTypes.shape({
    autoComplete: PropTypes.string,
    fullWidth: PropTypes.bool,
    helpText: PropTypes.node,
    inputMode: PropTypes.string,
    label: PropTypes.node.isRequired,
    max: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    min: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    name: PropTypes.string.isRequired,
    options: PropTypes.array,
    placeholder: PropTypes.string,
    readOnly: PropTypes.bool,
    required: PropTypes.bool,
    rows: PropTypes.number,
    sensitive: PropTypes.bool,
    step: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    type: PropTypes.string,
  }).isRequired,
  idPrefix: PropTypes.string.isRequired,
  readOnly: PropTypes.bool.isRequired,
  register: PropTypes.func.isRequired,
};

function PrincipalsEditor({
  disabled,
  errors,
  fields,
  idPrefix,
  onAppend,
  onRemove,
  readOnly,
  register,
}) {
  return (
    <div className="space-y-4">
      {fields.map((principal, index) => (
        <fieldset
          className="rounded-xl border border-border p-4 dark:border-slate-700"
          key={principal.id}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <legend className="font-semibold text-lga-navy dark:text-white">
              Principal {index + 1}
            </legend>
            {!readOnly && fields.length > 1 && (
              <button
                className="min-h-10 rounded-lg px-3 py-2 text-sm font-medium text-danger hover:bg-danger-light focus:outline-none focus:ring-2 focus:ring-danger disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-danger-dark"
                disabled={disabled}
                onClick={() => onRemove(index)}
                type="button"
              >
                Remove
              </button>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {[
              {
                name: `principals.${index}.firstName`,
                label: 'First name',
                required: true,
              },
              {
                name: `principals.${index}.lastName`,
                label: 'Last name',
                required: true,
              },
              {
                name: `principals.${index}.email`,
                label: 'Email address',
                type: 'email',
              },
              {
                name: `principals.${index}.npn`,
                label: 'NPN',
                inputMode: 'numeric',
              },
              {
                name: `principals.${index}.ownershipPercent`,
                label: 'Ownership percentage',
                type: 'number',
                min: 0,
                max: 100,
                required: true,
              },
              {
                name: `principals.${index}.isLicensedEligible`,
                label: 'Licensed and eligible principal',
                type: 'checkbox',
                fullWidth: true,
              },
            ].map((field) => (
              <FormField
                disabled={disabled}
                error={getErrorAtPath(errors, field.name)}
                field={field}
                idPrefix={idPrefix}
                key={field.name}
                readOnly={readOnly}
                register={register}
              />
            ))}
          </div>
        </fieldset>
      ))}

      {!readOnly && (
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
          disabled={disabled}
          onClick={onAppend}
          type="button"
        >
          Add principal
        </button>
      )}

      {errors.principals?.root?.message && (
        <p className="text-sm text-danger dark:text-red-200" role="alert">
          {errors.principals.root.message}
        </p>
      )}
      {typeof errors.principals?.message === 'string' && (
        <p className="text-sm text-danger dark:text-red-200" role="alert">
          {errors.principals.message}
        </p>
      )}
    </div>
  );
}

PrincipalsEditor.propTypes = {
  disabled: PropTypes.bool.isRequired,
  errors: PropTypes.object.isRequired,
  fields: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
    }),
  ).isRequired,
  idPrefix: PropTypes.string.isRequired,
  onAppend: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  readOnly: PropTypes.bool.isRequired,
  register: PropTypes.func.isRequired,
};

/**
 * Renders a React Hook Form and Zod-driven guided-journey section.
 */
export function JourneySectionForm({
  section,
  schema,
  fields,
  defaultValues = {},
  title,
  description,
  children,
  className = '',
  disabled = false,
  readOnly = false,
  loading = false,
  submitLabel = 'Save and continue',
  cancelLabel = 'Cancel',
  showActions = true,
  showCancel = false,
  onCancel,
  onSubmit,
  onSubmitError,
  onValuesChange,
  resetAfterSubmit = false,
}) {
  const generatedId = useId();
  const [submissionError, setSubmissionError] = useState('');
  const sectionKey = normalizeSection(section);
  const builtInDefinition = getJourneySectionDefinition(sectionKey);
  const resolvedFields = fields ?? builtInDefinition.fields;
  const resolvedSchema =
    schema ?? getJourneySectionSchema(sectionKey);
  const initialValues = useMemo(
    () =>
      mergeValues(
        DEFAULT_VALUES[sectionKey] ?? {},
        defaultValues,
      ),
    [defaultValues, sectionKey],
  );
  const {
    append: appendPrincipal,
    fields: principalFields,
    remove: removePrincipal,
  } = useFieldArray({
    control: undefined,
    name: 'principals',
  });
  const form = useForm({
    defaultValues: initialValues,
    resolver: zodResolver(resolvedSchema),
    mode: 'onBlur',
  });
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
    watch,
  } = form;
  const principalArray = useFieldArray({
    control,
    name: 'principals',
  });
  const sectionTitle =
    title ??
    (isObject(section) ? section.title : undefined) ??
    builtInDefinition.title;
  const sectionDescription =
    description ??
    (isObject(section) ? section.description : undefined) ??
    builtInDefinition.description;
  const headingId = `${generatedId}-heading`;
  const errorSummaryId = `${generatedId}-errors`;
  const errorMessages = [
    ...new Set(collectErrorMessages(errors)),
  ];
  const busy = loading || isSubmitting;

  void appendPrincipal;
  void principalFields;
  void removePrincipal;

  useEffect(() => {
    reset(initialValues);
    setSubmissionError('');
  }, [initialValues, reset]);

  useEffect(() => {
    if (typeof onValuesChange !== 'function') {
      return undefined;
    }

    const subscription = watch((values, details) => {
      onValuesChange(cloneValue(values), details);
    });

    return () => subscription.unsubscribe();
  }, [onValuesChange, watch]);

  const submitForm = async (values) => {
    setSubmissionError('');

    try {
      if (typeof onSubmit === 'function') {
        await onSubmit(cloneValue(values), {
          section: sectionKey,
          form,
        });
      }

      if (resetAfterSubmit) {
        reset(values);
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'The section could not be saved. Try again.';

      setSubmissionError(message);

      if (typeof onSubmitError === 'function') {
        onSubmitError(error);
      }
    }
  };

  return (
    <section
      aria-busy={busy}
      aria-labelledby={headingId}
      className={`w-full rounded-xl border border-border bg-white p-5 shadow-card sm:p-6 dark:border-slate-700 dark:bg-slate-900 ${className}`.trim()}
      data-journey-section={sectionKey}
    >
      <div className="mb-6">
        <h2
          className="text-xl font-semibold text-lga-navy dark:text-white"
          id={headingId}
        >
          {sectionTitle}
        </h2>
        {sectionDescription && (
          <p className="mt-2 text-sm leading-6 text-text-muted dark:text-slate-300">
            {sectionDescription}
          </p>
        )}
        <p className="mt-2 text-xs text-text-muted dark:text-slate-400">
          Fields marked with an asterisk are required. Use synthetic
          data only.
        </p>
      </div>

      {errorMessages.length > 0 && (
        <div
          aria-labelledby={`${errorSummaryId}-title`}
          className="mb-5 rounded-lg border border-danger bg-danger-light p-4 text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          id={errorSummaryId}
          role="alert"
        >
          <h3 className="font-semibold" id={`${errorSummaryId}-title`}>
            Review the following information
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {errorMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {submissionError && (
        <div
          className="mb-5 rounded-lg border border-danger bg-danger-light p-4 text-sm text-danger-dark dark:border-red-700 dark:bg-danger-dark dark:text-red-100"
          role="alert"
        >
          {submissionError}
        </div>
      )}

      <form
        aria-describedby={
          errorMessages.length > 0 ? errorSummaryId : undefined
        }
        noValidate
        onSubmit={handleSubmit(submitForm)}
      >
        <fieldset disabled={busy || disabled}>
          <legend className="sr-only">{sectionTitle}</legend>

          {sectionKey === JOURNEY_SECTION_TYPES.PRINCIPALS ? (
            <PrincipalsEditor
              disabled={busy || disabled}
              errors={errors}
              fields={principalArray.fields}
              idPrefix={generatedId}
              onAppend={() =>
                principalArray.append({
                  firstName: '',
                  lastName: '',
                  email: '',
                  ownershipPercent: '',
                  npn: '',
                  isLicensedEligible: false,
                })
              }
              onRemove={principalArray.remove}
              readOnly={readOnly}
              register={register}
            />
          ) : resolvedFields.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {resolvedFields.map((field) => (
                <FormField
                  disabled={busy || disabled}
                  error={getErrorAtPath(errors, field.name)}
                  field={field}
                  idPrefix={generatedId}
                  key={field.name}
                  readOnly={readOnly}
                  register={register}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-surface-muted p-4 text-sm text-text-muted dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              No additional information is required for this section.
            </div>
          )}

          {children && <div className="mt-5">{children}</div>}
        </fieldset>

        {showActions && (
          <div className="mt-6 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end dark:border-slate-700">
            {showCancel && (
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-5 py-2 text-sm font-semibold text-lga-navy transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900"
                disabled={busy}
                onClick={onCancel}
                type="button"
              >
                {cancelLabel}
              </button>
            )}

            {!readOnly && (
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-lga-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-lga-sky focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-primary-600 dark:hover:bg-primary-500 dark:focus:ring-offset-slate-900"
                disabled={busy || disabled}
                type="submit"
              >
                {busy ? 'Saving…' : submitLabel}
              </button>
            )}
          </div>
        )}

        <div aria-live="polite" className="sr-only" role="status">
          {busy ? 'Saving journey section.' : ''}
        </div>
      </form>
    </section>
  );
}

const fieldPropType = PropTypes.shape({
  autoComplete: PropTypes.string,
  fullWidth: PropTypes.bool,
  helpText: PropTypes.node,
  inputMode: PropTypes.string,
  label: PropTypes.node.isRequired,
  max: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  min: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  name: PropTypes.string.isRequired,
  options: PropTypes.array,
  placeholder: PropTypes.string,
  readOnly: PropTypes.bool,
  required: PropTypes.bool,
  rows: PropTypes.number,
  sensitive: PropTypes.bool,
  step: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  type: PropTypes.string,
});

JourneySectionForm.propTypes = {
  cancelLabel: PropTypes.node,
  children: PropTypes.node,
  className: PropTypes.string,
  defaultValues: PropTypes.object,
  description: PropTypes.node,
  disabled: PropTypes.bool,
  fields: PropTypes.arrayOf(fieldPropType),
  loading: PropTypes.bool,
  onCancel: PropTypes.func,
  onSubmit: PropTypes.func,
  onSubmitError: PropTypes.func,
  onValuesChange: PropTypes.func,
  readOnly: PropTypes.bool,
  resetAfterSubmit: PropTypes.bool,
  schema: PropTypes.shape({
    parse: PropTypes.func.isRequired,
    safeParse: PropTypes.func.isRequired,
  }),
  section: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.shape({
      description: PropTypes.node,
      id: PropTypes.string,
      section: PropTypes.string,
      stepId: PropTypes.string,
      title: PropTypes.node,
    }),
  ]).isRequired,
  showActions: PropTypes.bool,
  showCancel: PropTypes.bool,
  submitLabel: PropTypes.node,
  title: PropTypes.node,
};

export default JourneySectionForm;