import { z } from 'zod';
import { AdPriceUnit, AdPurpose } from './models/ad.model';

export const createAdSchema = z.object({
    body: z
        .object({
            purpose: z.nativeEnum(AdPurpose, {
                errorMap: () => ({ message: 'Invalid purpose. Must be sale, rent, or exchange' })
            }),
            propertyType: z.number({ required_error: 'Property type is required' }).int().positive(),
            area: z.number({ required_error: 'Area is required' }).int().positive(),
            price: z.number().min(0).optional().nullable(),
            priceUnit: z.nativeEnum(AdPriceUnit).optional(),
            phoneNumber: z.string({ required_error: 'Phone number is required' }),
            isPhoneHidden: z.boolean().optional(),
            alternativePhoneNumber: z.string().optional(),
            premiumAd: z.boolean().optional(),
            isPremium: z.boolean().optional(),
            description: z.string({ required_error: 'Description is required' }),
            media: z.array(z.string()).optional()
        })
        .strict()
});

export const updateAdSchema = z.object({
    body: z
        .object({
            purpose: z.nativeEnum(AdPurpose).optional(),
            propertyType: z.number().int().positive().optional(),
            area: z.number().int().positive().optional(),
            price: z.number().min(0).optional().nullable(),
            priceUnit: z.nativeEnum(AdPriceUnit).optional(),
            phoneNumber: z.string().optional(),
            isPhoneHidden: z.boolean().optional(),
            alternativePhoneNumber: z.string().optional(),
            premiumAd: z.boolean().optional(),
            isPremium: z.boolean().optional(),
            description: z.string().optional(),
            media: z.array(z.string()).optional(),
            status: z.string().optional(),
            user: z.string().optional()
        })
        .strict()
});
